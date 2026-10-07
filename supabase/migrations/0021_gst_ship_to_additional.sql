-- ============================================================================
-- NR Industries — 0021_gst_ship_to_additional.sql
--
-- GST, Ship To, Additional Amount, admin stage override.
--
-- DATA SAFETY: additive only. Two new columns on `orders` (constant default /
-- null, so no row is rewritten), and functions + the order_feed view are
-- replaced. No UPDATE, no DELETE, no dropped column: every existing order
-- and product keeps exactly the values it has (supabase/scripts/
-- 0021_snapshot.sql proves it before/after). `orders.price` and
-- `order_items.feat` are left in place, untouched.
--
--   * GST: 18% of each product's price, never of the Additional Amount.
--     Computed on read (gst_of), so it applies to every order — existing ones
--     included — without writing to any of them. Product total = price + GST.
--   * Additional Amount (replaces FEAT): ONE amount per order, added once at
--     the end: order subtotal = Σ(price + GST) + Additional Amount.
--     New orders store it in orders.additional_amount. Orders punched before
--     0021 have no such value; their per-product FEAT amounts (order_items.feat,
--     kept as-is) are read as their Additional Amount instead.
--   * Same privacy as price: no API role can SELECT orders.additional_amount
--     (orders has a column-level grant list since 0010; new columns are not
--     in it); it is read only through SECURITY DEFINER functions that null it
--     for anyone but admin tier and the punching account. GST likewise.
--   * Ship To: free text on the order (orders.ship_to), visible to everyone
--     who can see the order (it isn't a price).
--   * create_order() gains a 7-arg overload (ship to, additional amount). The
--     0020 5-arg and the 0019 9-arg versions are left untouched for the
--     deploy window.
--   * advance_order_stage(): admin tier may advance any active order with no
--     assignment and no timer check. Production is unchanged.
-- ============================================================================

begin;

-- ── 1. columns (additive) ──────────────────────────────────────────────────
alter table public.orders
  add column if not exists ship_to text not null default '' check (char_length(ship_to) <= 2000),
  add column if not exists additional_amount numeric(14,2)
    check (additional_amount is null or additional_amount >= 0);

-- ship_to is not a price: readable like the other order fields.
grant select (ship_to) on public.orders to authenticated;

-- ── 2. amounts ─────────────────────────────────────────────────────────────
-- 18% GST on one product's price, to the paisa.
create or replace function public.gst_of(p_price numeric)
returns numeric
language sql immutable set search_path = public as $$
  select round(p_price * 0.18, 2)
$$;

-- The order's Additional Amount, unfiltered (internal: callers apply the
-- viewer rule). Orders before 0021: their products' FEAT amounts.
create or replace function public.order_additional_amount(p_order_id uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(o.additional_amount,
                  (select sum(i.feat) from public.order_items i where i.order_id = o.id))
    from public.orders o
   where o.id = p_order_id
$$;
revoke all on function public.order_additional_amount(uuid) from public, anon, authenticated;

-- Order subtotal = Σ(price + GST) + Additional Amount; null when none given.
create or replace function public.order_price_for_viewer(p_order_id uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select case when public.is_admin_tier() or o.created_by = auth.uid()
              then (select case when count(i.price) = 0 and a.v is null then null
                                else coalesce(sum(i.price + public.gst_of(i.price)), 0) + coalesce(a.v, 0) end
                      from public.order_items i
                     where i.order_id = o.id)
              else null end
  from public.orders o
  cross join lateral (select public.order_additional_amount(o.id) as v) a
  where o.id = p_order_id
$$;

create or replace function public.order_additional_for_viewer(p_order_id uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select case when public.is_admin_tier() or o.created_by = auth.uid()
              then public.order_additional_amount(o.id) end
    from public.orders o
   where o.id = p_order_id
$$;
revoke all on function public.order_additional_for_viewer(uuid) from public, anon;
grant execute on function public.order_additional_for_viewer(uuid) to authenticated;

-- Products JSON gains `gst` (same viewer rule as price). `feat` stays for the
-- previous app build during the deploy window; this build ignores it.
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
           'gst', case when public.is_admin_tier() or o.created_by = auth.uid() then public.gst_of(i.price) end,
           'feat', case when public.is_admin_tier() or o.created_by = auth.uid() then i.feat end,
           'description', i.description
         ) order by i.position), '[]'::jsonb)
    from public.orders o
    join public.order_items i on i.order_id = o.id
   where o.id = p_order_id
     and (public.is_admin_tier() or o.created_by = auth.uid() or public.is_order_assignee(o.id))
$$;

-- Same columns as 0019, plus ship_to and additional_amount at the end.
create or replace view public.order_feed with (security_invoker = true) as
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
  ) as assignee_ids,
  public.order_items_for_viewer(o.id) as items,
  o.ship_to,
  public.order_additional_for_viewer(o.id) as additional_amount
from public.orders o;

-- ── 3. punching: ship to + one Additional Amount ───────────────────────────
-- p_items: [{product_name, transformer_rating, quantity, price|null,
-- description}, ...] — 1 to 20 products. Any `feat` key is ignored.
create or replace function public.create_order(
  p_created_by        uuid,
  p_client_name       text,
  p_ship_to           text,
  p_expected_delivery date,
  p_items             jsonb,
  p_additional_amount numeric,
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
  if char_length(coalesce(p_ship_to, '')) > 2000 then
    raise exception 'ship to is too long (up to 2000 characters)';
  end if;
  if p_additional_amount is not null
     and (p_additional_amount < 0 or p_additional_amount > 999999999999) then
    raise exception 'additional amount must be between 0 and 999,999,999,999';
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
    if char_length(coalesce(v_item->>'description', '')) > 4000 then
      raise exception 'product %: description is too long (up to 4000 characters)', v_pos;
    end if;
  end loop;

  v_first := p_items->0;
  -- order subtotal = Σ(price + GST) + Additional Amount; null when none given
  select case when count(p) = 0 and p_additional_amount is null then null
              else coalesce(sum(p + public.gst_of(p)), 0) + coalesce(p_additional_amount, 0) end
    into v_sum
    from (select (e->>'price')::numeric p from jsonb_array_elements(p_items) e
           where jsonb_typeof(e->'price') = 'number') x;

  -- orders' product columns mirror the first product; price is the subtotal
  insert into public.orders (created_by, product_name, client_name, ship_to, transformer_rating,
                             quantity, price, additional_amount, expected_delivery, description,
                             stage, status)
  values (p_created_by, btrim(v_first->>'product_name'), btrim(p_client_name),
          btrim(coalesce(p_ship_to, '')),
          btrim(v_first->>'transformer_rating'), (v_first->>'quantity')::int, v_sum,
          p_additional_amount, p_expected_delivery, coalesce(v_first->>'description', ''), 1, v_status)
  returning id into v_id;

  insert into public.order_items (order_id, position, product_name, transformer_rating,
                                  quantity, price, description)
  select v_id, e.ord::smallint, btrim(e.value->>'product_name'), btrim(e.value->>'transformer_rating'),
         (e.value->>'quantity')::int,
         case when jsonb_typeof(e.value->'price') = 'number' then (e.value->>'price')::numeric end,
         coalesce(e.value->>'description', '')
    from jsonb_array_elements(p_items) with ordinality as e(value, ord);

  insert into public.order_assignees (order_id, profile_id)
  select v_id, unnest(p_assignees);

  insert into public.order_stage_events (order_id, from_stage, to_stage, changed_by)
  values (v_id, null, 1, p_created_by);

  return query select v_id, v_status;
end $$;
revoke all on function public.create_order(uuid, text, text, date, jsonb, numeric, uuid[])
  from public, anon, authenticated;
grant execute on function public.create_order(uuid, text, text, date, jsonb, numeric, uuid[])
  to service_role;

-- ── 4. stage advance: admin tier overrides assignment + timer ──────────────
-- Same signature and outcomes as 0015. When p_actor is admin / head_admin the
-- assignee check and the timer check are skipped; the order must still be
-- active, not finished, and at the stage the admin was looking at. The next
-- production advance still waits for the timer, exactly as before.
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
  v_admin boolean;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    return query select 'not_found'::text, null::smallint, null::uuid, null::text, null::text, null::uuid[];
    return;
  end if;

  select array_agg(a.profile_id) into v_assignees
    from public.order_assignees a where a.order_id = o.id;
  v_admin := exists (select 1 from public.profiles p
                      where p.id = p_actor and p.role in ('admin', 'head_admin'));

  outcome := case
    when not v_admin and not (p_actor = any(coalesce(v_assignees, '{}'))) then 'not_assigned'
    when o.status <> 'active'                              then 'waiting'
    when o.stage >= 5                                      then 'delivered'
    when o.stage <> p_from_stage                           then 'stale'
    when not v_admin and o.stage_ready_at is not null and o.stage_ready_at > now() then 'timer'
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

-- ── 5. delete audit + archive export carry GST / Additional Amount ────────
-- to_jsonb(old) already includes ship_to and additional_amount.
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
           'price', i.price, 'gst', public.gst_of(i.price), 'feat', i.feat,
           'description', i.description) order by i.position), '[]'),
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
      'additional_amount', public.order_additional_amount(old.id),
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
             'ship_to', o.ship_to,
             'transformer_rating', o.transformer_rating,
             'quantity', o.quantity,
             'price', o.price,
             'additional_amount', public.order_additional_amount(o.id),
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
                                'price', i.price, 'gst', public.gst_of(i.price), 'feat', i.feat,
                                'description', i.description) order by i.position), '[]')
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
