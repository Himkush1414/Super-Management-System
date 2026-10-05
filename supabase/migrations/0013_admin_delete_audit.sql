-- ============================================================================
-- NR Industries — 0013_admin_delete_audit.sql
--
-- Lets admin-tier accounts clear data that marketing / production accounts
-- pile up over time, with every deletion recorded in an append-only
-- audit_log (the 0001 audit_log was dropped by the 0008 reset).
--
--   * Who may delete is enforced HERE, by RLS: only admin-tier sessions get
--     DELETE policies on orders / order_stage_events. The app's delete
--     actions run under the admin's own session (not the service role), so
--     RLS is the real gate, mirrored by `data.delete` in lib/permissions.ts.
--   * What gets audited is enforced HERE, by BEFORE DELETE triggers — not by
--     the app remembering to log. Any delete path (app, PostgREST, service
--     role, SQL console) writes an audit row with a snapshot of what was
--     removed, who removed it, and when.
--   * Account reset is one SECURITY DEFINER function that re-checks the
--     caller is admin-tier, deletes in one transaction, and writes a summary
--     row; the per-order / per-event rows it causes share its batch_id.
--   * head_admin invisibility: admin never sees audit rows whose actor is
--     head_admin, and nobody can reset or target a head_admin/admin account.
-- ============================================================================

begin;

-- ── 1. audit_log (append-only) ─────────────────────────────────────────────
create table public.audit_log (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  actor_id          uuid references public.profiles(id) on delete set null,
  actor_role        user_role,
  actor_label       text not null,          -- username at the time, or 'system'
  action            text not null,          -- order.delete | stage_event.delete | account.reset
  entity_type       text not null,          -- order | order_stage_event | account
  entity_id         uuid,
  target_profile_id uuid references public.profiles(id) on delete set null,
  summary           text not null,
  details           jsonb not null default '{}'::jsonb,  -- snapshot of what was removed
  batch_id          uuid                     -- groups the rows one account reset produced
);
create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_target_idx  on public.audit_log (target_profile_id, created_at desc);
create index audit_log_batch_idx   on public.audit_log (batch_id) where batch_id is not null;
alter table public.audit_log enable row level security;

create policy audit_log_select on public.audit_log
  for select using (
    public.is_admin_tier()
    and (actor_role is distinct from 'head_admin' or public.current_role_name() = 'head_admin')
  );
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;

create or replace function public.audit_log_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();

-- Who is acting: the signed-in user, or 'system' for service-role / console.
create or replace function public.audit_actor(out actor_id uuid, out actor_role user_role, out actor_label text)
language sql stable security definer set search_path = public as $$
  select p.id, p.role, coalesce(p.username, 'system')
    from (select auth.uid() as uid) u
    left join public.profiles p on p.id = u.uid
$$;

-- ── 2. audit triggers ──────────────────────────────────────────────────────
-- BEFORE DELETE so the snapshot can still read the order's children.
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
  select username into v_dispatcher from public.profiles where id = old.created_by;
  select coalesce(jsonb_agg(p.username order by p.username), '[]')
    into v_assignees
    from public.order_assignees oa join public.profiles p on p.id = oa.profile_id
   where oa.order_id = old.id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'from_stage', e.from_stage, 'to_stage', e.to_stage,
           'by', (select username from public.profiles where id = e.changed_by),
           'at', e.created_at) order by e.created_at), '[]')
    into v_events
    from public.order_stage_events e where e.order_id = old.id;

  -- notifications that point at this order would dangle; remove them too
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
create trigger audit_order_delete before delete on public.orders
  for each row execute function public.audit_order_delete();

create or replace function public.audit_stage_event_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a record;
  v_by text;
  v_product text;
begin
  -- depth > 1 = removed by the cascade of an order delete; that order's own
  -- audit row already holds this event in its snapshot.
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  select * into a from public.audit_actor();
  select username into v_by from public.profiles where id = old.changed_by;
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
create trigger audit_stage_event_delete before delete on public.order_stage_events
  for each row execute function public.audit_stage_event_delete();

-- ── 3. who may delete (RLS) ────────────────────────────────────────────────
create policy orders_admin_delete on public.orders
  for delete using (public.is_admin_tier());
create policy ose_admin_delete on public.order_stage_events
  for delete using (public.is_admin_tier());
-- notifications: no DELETE policy — only removed by the triggers above or by
-- admin_reset_account(), both of which audit.

-- ── 4. per-account overview for the admin data page ────────────────────────
create or replace function public.admin_account_overview()
returns table (
  profile_id uuid, username text, full_name text, role user_role,
  orders_dispatched int, orders_assigned int, stage_updates int, notifications int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin_tier() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  return query
  select p.id, p.username, p.full_name, p.role,
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

-- ── 5. account reset ───────────────────────────────────────────────────────
--   marketing:  p_orders        -> orders it dispatched (with their history)
--               p_notifications -> its notifications
--   production: p_stage_events  -> stage updates it made (history only; the
--                                  orders keep their current stage)
--               p_orders        -> orders assigned to it — deletes those
--                                  orders for everyone involved
--               p_notifications -> its notifications
create or replace function public.admin_reset_account(
  p_profile_id    uuid,
  p_orders        boolean,
  p_stage_events  boolean,
  p_notifications boolean
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a        record;
  t        public.profiles%rowtype;
  v_batch  uuid := gen_random_uuid();
  n_orders int := 0;
  n_events int := 0;
  n_notifs int := 0;
  v_notif_snapshot jsonb := '[]';
  v_counts jsonb;
begin
  if not public.is_admin_tier() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select * into t from public.profiles where id = p_profile_id;
  if t.id is null or t.role not in ('marketing', 'production') then
    raise exception 'only marketing or production accounts can be reset';
  end if;
  if not (coalesce(p_orders, false) or coalesce(p_stage_events, false) or coalesce(p_notifications, false)) then
    raise exception 'nothing selected';
  end if;

  select * into a from public.audit_actor();
  -- the summary row goes first so per-item rows can point at its batch
  perform set_config('nr.audit_batch', v_batch::text, true);

  -- notifications first, so the summary counts all of this account's
  -- notifications (deleting an order would otherwise remove the ones about
  -- that order first and report them only on the order's own audit row)
  if p_notifications then
    select coalesce(jsonb_agg(jsonb_build_object('title', title, 'body', body, 'at', created_at)
                              order by created_at), '[]')
      into v_notif_snapshot
      from public.notifications where user_id = t.id;
    delete from public.notifications where user_id = t.id;
    get diagnostics n_notifs = row_count;
  end if;

  if p_stage_events and t.role = 'production' then
    delete from public.order_stage_events where changed_by = t.id and from_stage is not null;
    get diagnostics n_events = row_count;
  end if;

  if p_orders then
    if t.role = 'marketing' then
      delete from public.orders where created_by = t.id;
    else
      delete from public.orders o
       where exists (select 1 from public.order_assignees oa
                      where oa.order_id = o.id and oa.profile_id = t.id);
    end if;
    get diagnostics n_orders = row_count;
  end if;

  perform set_config('nr.audit_batch', '', true);

  v_counts := jsonb_build_object('orders', n_orders, 'stage_updates', n_events, 'notifications', n_notifs);
  insert into public.audit_log (actor_id, actor_role, actor_label, action, entity_type, entity_id,
                                target_profile_id, summary, details, batch_id)
  values (
    a.actor_id, a.actor_role, a.actor_label, 'account.reset', 'account', t.id, t.id,
    format('Reset %s (%s): %s orders, %s stage updates, %s notifications deleted',
           t.username, t.role, n_orders, n_events, n_notifs),
    jsonb_build_object(
      'account', jsonb_build_object('username', t.username, 'role', t.role),
      'scopes', jsonb_build_object('orders', p_orders, 'stage_updates', p_stage_events, 'notifications', p_notifications),
      'counts', v_counts,
      'notifications', v_notif_snapshot),
    v_batch
  );

  return v_counts || jsonb_build_object('batch_id', v_batch);
end $$;
revoke all on function public.admin_reset_account(uuid, boolean, boolean, boolean) from public, anon;
grant execute on function public.admin_reset_account(uuid, boolean, boolean, boolean) to authenticated;

-- audit_actor / trigger helpers are internal
revoke all on function public.audit_actor() from public, anon, authenticated;

commit;
