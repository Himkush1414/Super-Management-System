-- ============================================================================
-- NR Industries — 0016_real_names.sql
--
-- Marketing and production accounts must give their real name. Wherever such
-- an account appears as an actor it is shown as "Real Name (Production 1)";
-- admin / head_admin keep their existing label.
--
--   * profiles.real_name — set by the account itself through a server action
--     (profiles stay non-editable through the API, 0014).
--   * Hard gates (enforced here, not only in the UI):
--       - create_order() refuses a marketing account with no real name;
--       - an order only becomes `active` when EVERY assigned production
--         member has a real name AND a confirmed phone (the existing phone
--         gate, extended) — until then it waits and cannot advance.
--   * Audit rows written from now on carry display names. Older audit rows
--     are left exactly as written (audit_log is append-only).
-- ============================================================================

begin;

alter table public.profiles
  add column real_name text
  check (real_name is null or char_length(btrim(real_name)) between 2 and 80);

-- "Real Name (Production 1)" for marketing/production with a real name,
-- otherwise the account's existing label. Internal: callable only from other
-- SECURITY DEFINER code (exposing it would let anyone resolve any id —
-- including head_admin's).
create or replace function public.display_name(p_profile_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case
           when p.role in ('marketing', 'production') and p.real_name is not null
             then p.real_name || ' (' || p.full_name || ')'
           else p.full_name
         end
    from public.profiles p
   where p.id = p_profile_id
$$;
revoke all on function public.display_name(uuid) from public, anon, authenticated;

-- A production member is "ready" when both real name and confirmed phone exist.
create or replace function public.production_member_ready(p_profile_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.profiles p
      join public.production_settings s on s.profile_id = p.id
     where p.id = p_profile_id
       and p.real_name is not null
       and s.phone is not null and s.confirmed_at is not null)
$$;
revoke all on function public.production_member_ready(uuid) from public, anon, authenticated;

-- ── audit labels use display names from now on ─────────────────────────────
create or replace function public.audit_actor(out actor_id uuid, out actor_role user_role, out actor_label text)
language sql stable security definer set search_path = public as $$
  select p.id, p.role, coalesce(public.display_name(p.id), 'system')
    from (select auth.uid() as uid) u
    left join public.profiles p on p.id = u.uid
$$;
revoke all on function public.audit_actor() from public, anon, authenticated;

create or replace function public.audit_order_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a record;
  v_dispatcher text;
  v_assignees jsonb;
  v_events jsonb;
  v_notifs int;
begin
  select * into a from public.audit_actor();
  v_dispatcher := public.display_name(old.created_by);
  select coalesce(jsonb_agg(public.display_name(oa.profile_id) order by public.display_name(oa.profile_id)), '[]')
    into v_assignees
    from public.order_assignees oa
   where oa.order_id = old.id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'from_stage', e.from_stage, 'to_stage', e.to_stage,
           'by', public.display_name(e.changed_by),
           'at', e.created_at) order by e.created_at), '[]')
    into v_events
    from public.order_stage_events e where e.order_id = old.id;

  delete from public.notifications where entity_type = 'order' and entity_id = old.id;
  get diagnostics v_notifs = row_count;

  insert into public.audit_log (actor_id, actor_role, actor_label, action, entity_type, entity_id,
                                target_profile_id, summary, details, batch_id)
  values (
    a.actor_id, a.actor_role, a.actor_label, 'order.delete', 'order', old.id,
    old.created_by,
    format('Deleted order "%s" for %s (dispatched by %s)',
           old.product_name, coalesce(nullif(old.client_name, ''), 'no client'), coalesce(v_dispatcher, '?')),
    jsonb_build_object(
      'order', to_jsonb(old),
      'dispatched_by', v_dispatcher,
      'assignees', v_assignees,
      'stage_events', v_events,
      'notifications_removed', v_notifs),
    nullif(current_setting('nr.audit_batch', true), '')::uuid
  );
  return old;
end $$;

create or replace function public.audit_stage_event_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a record;
  v_by text;
  v_product text;
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  select * into a from public.audit_actor();
  v_by := public.display_name(old.changed_by);
  select product_name into v_product from public.orders where id = old.order_id;

  insert into public.audit_log (actor_id, actor_role, actor_label, action, entity_type, entity_id,
                                target_profile_id, summary, details, batch_id)
  values (
    a.actor_id, a.actor_role, a.actor_label, 'stage_event.delete', 'order_stage_event', old.id,
    old.changed_by,
    format('Deleted stage update %s → %s on "%s" (made by %s)',
           coalesce(old.from_stage::text, 'new'), old.to_stage, coalesce(v_product, '?'), coalesce(v_by, '?')),
    jsonb_build_object('event', to_jsonb(old), 'made_by', v_by, 'order_product', v_product),
    nullif(current_setting('nr.audit_batch', true), '')::uuid
  );
  return old;
end $$;

-- ── overview: return type gains real_name / display_name -> drop + create ──
drop function if exists public.admin_account_overview();
create function public.admin_account_overview()
returns table (
  profile_id uuid, username text, full_name text, real_name text, display_name text, role user_role,
  orders_dispatched int, orders_assigned int, stage_updates int, notifications int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin_tier() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  return query
  select p.id, p.username, p.full_name, p.real_name, public.display_name(p.id), p.role,
         (select count(*)::int from public.orders o where o.created_by = p.id),
         (select count(*)::int from public.order_assignees a where a.profile_id = p.id),
         (select count(*)::int from public.order_stage_events e where e.changed_by = p.id and e.from_stage is not null),
         (select count(*)::int from public.notifications n where n.user_id = p.id)
    from public.profiles p
   where p.role in ('marketing', 'production')
   order by p.role, p.username;
end $$;
revoke all on function public.admin_account_overview() from public, anon;
grant execute on function public.admin_account_overview() to authenticated;

-- ── dispatch gates ─────────────────────────────────────────────────────────
create or replace function public.create_order(
  p_created_by         uuid,
  p_product_name       text,
  p_client_name        text,
  p_transformer_rating text,
  p_quantity           integer,
  p_price              numeric,
  p_expected_delivery  date,
  p_description        text,
  p_assignees          uuid[]
)
returns table (order_id uuid, status text)
language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid;
  v_status text;
  v_ready  int;
  v_total  int;
begin
  if not exists (select 1 from public.profiles
                 where id = p_created_by and role = 'marketing') then
    raise exception 'only marketing accounts can dispatch orders';
  end if;
  if exists (select 1 from public.profiles where id = p_created_by and real_name is null) then
    raise exception 'add your real name before dispatching orders' using errcode = 'P0001';
  end if;

  p_assignees := array(select distinct unnest(p_assignees));
  v_total := coalesce(array_length(p_assignees, 1), 0);
  if v_total = 0 then
    raise exception 'choose at least one production member';
  end if;

  select count(*) into v_ready
    from unnest(p_assignees) a(id)
   where public.production_member_ready(a.id);
  v_status := case when v_ready = v_total then 'active' else 'waiting_on_production_phone' end;

  insert into public.orders (created_by, product_name, client_name, transformer_rating,
                             quantity, price, expected_delivery, description, stage, status)
  values (p_created_by, p_product_name, p_client_name, p_transformer_rating,
          p_quantity, p_price, p_expected_delivery, p_description, 1, v_status)
  returning id into v_id;

  insert into public.order_assignees (order_id, profile_id)
  select v_id, unnest(p_assignees);

  insert into public.order_stage_events (order_id, from_stage, to_stage, changed_by)
  values (v_id, null, 1, p_created_by);

  return query select v_id, v_status;
end $$;
revoke all on function public.create_order(uuid, text, text, text, integer, numeric, date, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.create_order(uuid, text, text, text, integer, numeric, date, text, uuid[])
  to service_role;

-- Activate every waiting order whose assignees are now all ready. Called by
-- the production settings action after a member saves name + phone.
create or replace function public.activate_ready_orders(p_profile_id uuid)
returns table (order_id uuid, created_by uuid, product_name text, assignee_ids uuid[])
language plpgsql security definer set search_path = public as $$
begin
  return query
  with candidates as (
    select o.id
      from public.orders o
      join public.order_assignees mine on mine.order_id = o.id and mine.profile_id = p_profile_id
     where o.status = 'waiting_on_production_phone'
       and not exists (select 1 from public.order_assignees a
                        where a.order_id = o.id and not public.production_member_ready(a.profile_id))
  ),
  upd as (
    update public.orders o set status = 'active'
      from candidates c where o.id = c.id
    returning o.id, o.created_by, o.product_name
  )
  select u.id, u.created_by, u.product_name,
         array(select a.profile_id from public.order_assignees a where a.order_id = u.id)
    from upd u;
end $$;
revoke all on function public.activate_ready_orders(uuid) from public, anon, authenticated;
grant execute on function public.activate_ready_orders(uuid) to service_role;

commit;
