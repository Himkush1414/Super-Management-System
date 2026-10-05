-- ============================================================================
-- NR Industries — 0017_reset_export.sql
--
-- Account reset gains "Download this data" before deleting:
--   * admin_account_export() returns exactly what a reset with the same
--     scopes would delete (orders with their history and assignees, the
--     account's stage updates, its notifications) for the archive PDF.
--     Admin tier only, marketing/production targets only — same checks as
--     admin_reset_account().
--   * admin_reset_account() takes p_exported and records in the reset's
--     audit row whether a copy was downloaded first.
-- ============================================================================

begin;

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

-- reset: same as 0013 + p_exported, recorded in the summary row
drop function if exists public.admin_reset_account(uuid, boolean, boolean, boolean);
create function public.admin_reset_account(
  p_profile_id    uuid,
  p_orders        boolean,
  p_stage_events  boolean,
  p_notifications boolean,
  p_exported      boolean default false
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
  v_label  text;
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
  v_label := public.display_name(t.id);
  perform set_config('nr.audit_batch', v_batch::text, true);

  -- notifications first, so the summary counts all of this account's
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
    format('Reset %s: %s orders, %s stage updates, %s notifications deleted%s',
           v_label, n_orders, n_events, n_notifs,
           case when coalesce(p_exported, false) then ' (a copy was downloaded first)' else '' end),
    jsonb_build_object(
      'account', jsonb_build_object('username', t.username, 'role', t.role, 'display_name', v_label),
      'scopes', jsonb_build_object('orders', p_orders, 'stage_updates', p_stage_events, 'notifications', p_notifications),
      'counts', v_counts,
      'exported_before_delete', coalesce(p_exported, false),
      'notifications', v_notif_snapshot),
    v_batch
  );

  return v_counts || jsonb_build_object('batch_id', v_batch);
end $$;
revoke all on function public.admin_reset_account(uuid, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.admin_reset_account(uuid, boolean, boolean, boolean, boolean) to authenticated;

commit;
