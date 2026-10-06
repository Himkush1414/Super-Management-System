-- ============================================================================
-- NR Industries — 0020_order_item_feat.sql
--
-- FEAT: an extra amount per product (additional cost, freight or similar),
-- entered by marketing next to the product's price.
--
--   * order_items.feat — numeric, optional, >= 0. Same lockdown as price:
--     no API role can SELECT it (0019 granted a column list; new columns
--     are not in it), read only through order_items_for_viewer(), which
--     nulls it for anyone but admin tier and the punching account.
--   * A product's value = price + FEAT. The order value (order_feed.price,
--     orders.price for new orders) = the sum over all products of both.
--   * create_order() validates and stores FEAT; the delete audit snapshot
--     and the account archive export carry it.
--   * Existing products have no FEAT (null), so no existing total changes.
-- ============================================================================

begin;

alter table public.order_items
  add column feat numeric(14,2) check (feat is null or feat >= 0);

-- ── reads: order value = sum of price + FEAT, same viewer rule ─────────────
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

-- ── punching: FEAT per product ─────────────────────────────────────────────
create or replace function public.create_order(
  p_created_by        uuid,
  p_client_name       text,
  p_expected_delivery date,
  p_items             jsonb,
  p_assignees         uuid[]
)
returns table (order_id uuid, status text)
language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid;
  v_status text;
  v_ready  int;
  v_total  int;
  v_n      int;
  v_first  jsonb;
  v_item   jsonb;
  v_pos    int := 0;
  v_name   text;
  v_rating text;
  v_qty    int;
  v_price  numeric;
  v_desc   text;
  v_sum    numeric;
begin
  if not exists (select 1 from public.profiles
                 where id = p_created_by and role = 'marketing') then
    raise exception 'only marketing accounts can punch orders';
  end if;
  if exists (select 1 from public.profiles where id = p_created_by and real_name is null) then
    raise exception 'add your real name before punching orders' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_client_name), '') = '' then
    raise exception 'client name is required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'an order needs at least one product';
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n < 1 or v_n > 20 then
    raise exception 'an order needs between 1 and 20 products';
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

  -- validate every product before writing anything
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_pos := v_pos + 1;
    v_name := btrim(coalesce(v_item->>'product_name', ''));
    v_rating := btrim(coalesce(v_item->>'transformer_rating', ''));
    if v_name = '' or char_length(v_name) > 200 then
      raise exception 'product %: product name is required (up to 200 characters)', v_pos;
    end if;
    if v_rating = '' or char_length(v_rating) > 120 then
      raise exception 'product %: transformer rating is required (up to 120 characters)', v_pos;
    end if;
    -- nested ifs: SQL doesn't promise to short-circuit OR, and the casts
    -- are only safe once the JSON type is known to be a number
    if coalesce(jsonb_typeof(v_item->'quantity'), 'missing') <> 'number' then
      raise exception 'product %: quantity must be a whole number of at least 1', v_pos;
    end if;
    if (v_item->>'quantity')::numeric <> trunc((v_item->>'quantity')::numeric)
       or (v_item->>'quantity')::numeric < 1
       or (v_item->>'quantity')::numeric > 1000000 then
      raise exception 'product %: quantity must be a whole number of at least 1', v_pos;
    end if;
    if coalesce(jsonb_typeof(v_item->'price'), 'null') not in ('number', 'null') then
      raise exception 'product %: value must be a number', v_pos;
    end if;
    if jsonb_typeof(v_item->'price') = 'number' then
      if (v_item->>'price')::numeric < 0 or (v_item->>'price')::numeric > 999999999999 then
        raise exception 'product %: value must be between 0 and 999,999,999,999', v_pos;
      end if;
    end if;
    if coalesce(jsonb_typeof(v_item->'feat'), 'null') not in ('number', 'null') then
      raise exception 'product %: FEAT must be a number', v_pos;
    end if;
    if jsonb_typeof(v_item->'feat') = 'number' then
      if (v_item->>'feat')::numeric < 0 or (v_item->>'feat')::numeric > 999999999999 then
        raise exception 'product %: FEAT must be between 0 and 999,999,999,999', v_pos;
      end if;
    end if;
    if char_length(coalesce(v_item->>'description', '')) > 4000 then
      raise exception 'product %: description is too long (up to 4000 characters)', v_pos;
    end if;
  end loop;

  v_first := p_items->0;
  -- order value = every product's price + FEAT; null when none was given
  select sum(v) into v_sum
    from (select (e->>'price')::numeric v from jsonb_array_elements(p_items) e
           where jsonb_typeof(e->'price') = 'number'
          union all
          select (e->>'feat')::numeric from jsonb_array_elements(p_items) e
           where jsonb_typeof(e->'feat') = 'number') x;

  -- orders' product columns mirror the first product; price is the total
  insert into public.orders (created_by, product_name, client_name, transformer_rating,
                             quantity, price, expected_delivery, description, stage, status)
  values (p_created_by, btrim(v_first->>'product_name'), btrim(p_client_name),
          btrim(v_first->>'transformer_rating'), (v_first->>'quantity')::int, v_sum,
          p_expected_delivery, coalesce(v_first->>'description', ''), 1, v_status)
  returning id into v_id;

  insert into public.order_items (order_id, position, product_name, transformer_rating,
                                  quantity, price, feat, description)
  select v_id, e.ord::smallint, btrim(e.value->>'product_name'), btrim(e.value->>'transformer_rating'),
         (e.value->>'quantity')::int,
         case when jsonb_typeof(e.value->'price') = 'number' then (e.value->>'price')::numeric end,
         case when jsonb_typeof(e.value->'feat') = 'number' then (e.value->>'feat')::numeric end,
         coalesce(e.value->>'description', '')
    from jsonb_array_elements(p_items) with ordinality as e(value, ord);

  insert into public.order_assignees (order_id, profile_id)
  select v_id, unnest(p_assignees);

  insert into public.order_stage_events (order_id, from_stage, to_stage, changed_by)
  values (v_id, null, 1, p_created_by);

  return query select v_id, v_status;
end $$;
revoke all on function public.create_order(uuid, text, date, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.create_order(uuid, text, date, jsonb, uuid[])
  to service_role;


-- ── delete audit + archive export carry FEAT ───────────────────────────────
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


commit;
