-- ============================================================================
-- NR Industries — supabase/scripts/0021_rollback.sql   (NOT a migration)
--
-- Back to 0020 behaviour WITHOUT deleting anything: every function body below
-- is copied verbatim from 0020 (advance_order_stage from 0015), and the 7-arg
-- create_order is dropped. The new columns (orders.ship_to,
-- orders.additional_amount), their values, gst_of() and the two Additional
-- Amount functions are KEPT, so no punched data is lost; order_feed keeps its
-- two extra columns (the 0020 app build ignores them). Under 0020 pricing an
-- order punched after 0021 shows Σ price (+ FEAT) — its Additional Amount and
-- GST are still stored/derivable, just not added in.
-- ============================================================================

begin;

create or replace function public.order_price_for_viewer(p_order_id uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select case when public.is_admin_tier() or o.created_by = auth.uid()
              then (select case when count(i.price) + count(i.feat) = 0 then null
                                else coalesce(sum(i.price), 0) + coalesce(sum(i.feat), 0) end
                      from public.order_items i where i.order_id = o.id)
              else null end
  from public.orders o
  where o.id = p_order_id
$$;

create or replace function public.order_items_for_viewer(p_order_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id,
           'position', i.position,
           'product_name', i.product_name,
           'transformer_rating', i.transformer_rating,
           'quantity', i.quantity,
           'price', case when public.is_admin_tier() or o.created_by = auth.uid() then i.price end,
           'feat', case when public.is_admin_tier() or o.created_by = auth.uid() then i.feat end,
           'description', i.description
         ) order by i.position), '[]'::jsonb)
    from public.orders o
    join public.order_items i on i.order_id = o.id
   where o.id = p_order_id
     and (public.is_admin_tier() or o.created_by = auth.uid() or public.is_order_assignee(o.id))
$$;

create or replace function public.advance_order_stage(
  p_order_id      uuid,
  p_actor         uuid,
  p_from_stage    smallint,
  p_timer_seconds int
)
returns table (
  outcome           text,      -- ok | not_found | not_assigned | waiting | delivered | timer | stale
  stage             smallint,  -- the order's stage after the call
  created_by        uuid,
  product_name      text,
  whatsapp_group_id text,
  assignee_ids      uuid[]
)
language plpgsql security definer set search_path = public as $$
declare
  o   public.orders%rowtype;
  v_to smallint;
  v_assignees uuid[];
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    return query select 'not_found'::text, null::smallint, null::uuid, null::text, null::text, null::uuid[];
    return;
  end if;

  select array_agg(a.profile_id) into v_assignees
    from public.order_assignees a where a.order_id = o.id;

  outcome := case
    when not (p_actor = any(coalesce(v_assignees, '{}'))) then 'not_assigned'
    when o.status <> 'active'                              then 'waiting'
    when o.stage >= 5                                      then 'delivered'
    when o.stage <> p_from_stage                           then 'stale'
    when o.stage_ready_at is not null and o.stage_ready_at > now() then 'timer'
    else 'ok'
  end;

  if outcome <> 'ok' then
    return query select outcome, o.stage, o.created_by, o.product_name, o.whatsapp_group_id, v_assignees;
    return;
  end if;

  v_to := o.stage + 1;
  update public.orders
     set stage = v_to,
         stage_ready_at = case when v_to < 5 then now() + make_interval(secs => p_timer_seconds) end
   where id = o.id;

  insert into public.order_stage_events (order_id, from_stage, to_stage, changed_by)
  values (o.id, o.stage, v_to, p_actor);

  return query select 'ok'::text, v_to, o.created_by, o.product_name, o.whatsapp_group_id, v_assignees;
end $$;

revoke all on function public.advance_order_stage(uuid, uuid, smallint, int) from public, anon, authenticated;
grant execute on function public.advance_order_stage(uuid, uuid, smallint, int) to service_role;

create or replace function public.audit_order_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a record;
  v_dispatcher text;
  v_assignees jsonb;
  v_events jsonb;
  v_items jsonb;
  v_count int;
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
  select coalesce(jsonb_agg(jsonb_build_object(
           'position', i.position, 'product_name', i.product_name,
           'transformer_rating', i.transformer_rating, 'quantity', i.quantity,
           'price', i.price, 'feat', i.feat, 'description', i.description) order by i.position), '[]'),
         count(*)
    into v_items, v_count
    from public.order_items i where i.order_id = old.id;

  delete from public.notifications where entity_type = 'order' and entity_id = old.id;
  get diagnostics v_notifs = row_count;

  insert into public.audit_log (actor_id, actor_role, actor_label, action, entity_type, entity_id,
                                target_profile_id, summary, details, batch_id)
  values (
    a.actor_id, a.actor_role, a.actor_label, 'order.delete', 'order', old.id,
    old.created_by,
    format('Deleted order "%s"%s for %s (punched by %s)',
           old.product_name,
           case when v_count > 1 then format(' +%s more', v_count - 1) else '' end,
           coalesce(nullif(old.client_name, ''), 'no client'), coalesce(v_dispatcher, '?')),
    jsonb_build_object(
      'order', to_jsonb(old),
      'items', v_items,
      'dispatched_by', v_dispatcher,
      'assignees', v_assignees,
      'stage_events', v_events,
      'notifications_removed', v_notifs),
    nullif(current_setting('nr.audit_batch', true), '')::uuid
  );
  return old;
end $$;

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
                              from public.order_assignees a where a.order_id = o.id),
             'items', (select coalesce(jsonb_agg(jsonb_build_object(
                                'position', i.position, 'product_name', i.product_name,
                                'transformer_rating', i.transformer_rating, 'quantity', i.quantity,
                                'price', i.price, 'feat', i.feat, 'description', i.description) order by i.position), '[]')
                         from public.order_items i where i.order_id = o.id)
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

drop function public.create_order(uuid, text, text, date, jsonb, numeric, uuid[]);

delete from supabase_migrations.schema_migrations where version = '0021';

commit;
