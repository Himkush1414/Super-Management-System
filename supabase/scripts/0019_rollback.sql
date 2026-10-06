-- ============================================================================
-- NR Industries — supabase/scripts/0019_rollback.sql   (NOT a migration)
--
-- Puts the database back exactly as it was at 0018, if 0019 has to be undone.
-- Every function body below is copied verbatim from the migration that last
-- defined it (0010, 0012, 0016, 0017).
--
-- DATA: order_items is dropped. Orders punched with ONE product lose nothing
-- (orders' own columns hold that product). Orders punched with SEVERAL
-- products after 0019 keep only their first product's name / rating /
-- quantity / description and the total value in orders.price — the other
-- products' rows are lost. Download the CSV first if any exist:
--   select count(*) from (select order_id from public.order_items
--                          group by order_id having count(*) > 1) x;
-- ============================================================================

begin;

drop view if exists public.order_feed;
drop function if exists public.order_items_for_viewer(uuid);
drop function if exists public.create_order(uuid, text, date, jsonb, uuid[]);

-- 0010
create or replace function public.order_price_for_viewer(p_order_id uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select case when public.is_admin_tier() or o.created_by = auth.uid()
              then o.price else null end
  from public.orders o
  where o.id = p_order_id
$$;

revoke all on function public.order_price_for_viewer(uuid) from public;
grant execute on function public.order_price_for_viewer(uuid) to authenticated;

-- 0012
create view public.order_feed with (security_invoker = true) as
select
  o.id, o.created_by,
  o.product_name, o.client_name, o.transformer_rating, o.quantity,
  o.expected_delivery, o.description,
  o.stage, o.status,
  public.order_price_for_viewer(o.id) as price,
  o.whatsapp_group_created, o.whatsapp_group_id,
  o.created_at, o.updated_at, o.stage_ready_at,
  coalesce(
    (select array_agg(a.profile_id order by a.created_at, a.profile_id)
       from public.order_assignees a
      where a.order_id = o.id),
    '{}'::uuid[]
  ) as assignee_ids
from public.orders o;

revoke all on public.order_feed from anon;
grant select on public.order_feed to authenticated;


-- 0016
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


-- 0016
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


-- 0017
create or replace function public.admin_account_export(
  p_profile_id    uuid,
  p_orders        boolean,
  p_stage_events  boolean,
  p_notifications boolean
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t public.profiles%rowtype;
  v_orders jsonb := '[]';
  v_events jsonb := '[]';
  v_notifs jsonb := '[]';
begin
  if not public.is_admin_tier() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select * into t from public.profiles where id = p_profile_id;
  if t.id is null or t.role not in ('marketing', 'production') then
    raise exception 'only marketing or production accounts can be exported';
  end if;

  if p_orders then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', o.id,
             'product_name', o.product_name,
             'client_name', o.client_name,
             'transformer_rating', o.transformer_rating,
             'quantity', o.quantity,
             'price', o.price,
             'expected_delivery', o.expected_delivery,
             'description', o.description,
             'stage', o.stage,
             'status', o.status,
             'created_at', o.created_at,
             'dispatched_by', public.display_name(o.created_by),
             'production', (select coalesce(jsonb_agg(public.display_name(a.profile_id)
                                                      order by public.display_name(a.profile_id)), '[]')
                              from public.order_assignees a where a.order_id = o.id)
           ) order by o.created_at), '[]')
      into v_orders
      from public.orders o
     where (t.role = 'marketing' and o.created_by = t.id)
        or (t.role = 'production' and exists (select 1 from public.order_assignees a
                                               where a.order_id = o.id and a.profile_id = t.id));
  end if;

  if p_stage_events and t.role = 'production' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', e.id,
             'order_product', o.product_name,
             'order_client', o.client_name,
             'from_stage', e.from_stage,
             'to_stage', e.to_stage,
             'created_at', e.created_at
           ) order by e.created_at), '[]')
      into v_events
      from public.order_stage_events e
      left join public.orders o on o.id = e.order_id
     where e.changed_by = t.id and e.from_stage is not null;
  end if;

  if p_notifications then
    select coalesce(jsonb_agg(jsonb_build_object(
             'title', n.title, 'body', n.body, 'read', n.read_at is not null, 'created_at', n.created_at
           ) order by n.created_at), '[]')
      into v_notifs
      from public.notifications n where n.user_id = t.id;
  end if;

  return jsonb_build_object(
    'account', jsonb_build_object('username', t.username, 'role', t.role,
                                  'display_name', public.display_name(t.id)),
    'orders', v_orders,
    'stage_updates', v_events,
    'notifications', v_notifs);
end $$;
revoke all on function public.admin_account_export(uuid, boolean, boolean, boolean) from public, anon;
grant execute on function public.admin_account_export(uuid, boolean, boolean, boolean) to authenticated;


drop table if exists public.order_items;

delete from supabase_migrations.schema_migrations where version = '0019';

commit;
