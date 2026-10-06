-- ============================================================================
-- NR Industries — 0019_order_items.sql
--
-- Several products in one order.
--
--   * `order_items` — one row per product: product name, transformer rating,
--     quantity, value (`price`), description, in the order they were entered.
--     Client name, expected delivery, stage, status, assignees and the
--     punching account stay on `orders`: the whole order moves through the
--     stages together and goes to one production team.
--   * Every existing order becomes a one-product order (backfilled from its
--     own columns), so nothing about existing orders changes.
--   * The order's value is the sum of its products' values. Price privacy is
--     the same rule as orders.price (0010): no API role can SELECT
--     order_items.price; it is only read through SECURITY DEFINER functions
--     that null it for anyone but admin tier and the punching account.
--   * `orders.product_name / transformer_rating / quantity / description`
--     now mirror the FIRST product and `orders.price` holds the order total.
--     They stay because existing DB functions (stage advance, activation,
--     audit) use product_name as the order's title, and so the previous app
--     build keeps working while the new one deploys. The app reads products
--     only from order_feed.items.
--   * create_order() gains an items-based overload. The old signature is
--     kept for the deploy window and now also writes its one product, so an
--     order punched by the old build is still complete. Drop it afterwards.
--   * Delete audit: products are snapshotted; the summary says "punched by".
--   * Account archive export: each order carries its products.
-- ============================================================================

begin;

-- ── 1. table ───────────────────────────────────────────────────────────────
create table public.order_items (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders(id) on delete cascade,
  position           smallint not null check (position >= 1),
  product_name       text not null,
  transformer_rating text not null default '',
  quantity           integer not null check (quantity > 0),
  price              numeric(14,2) check (price is null or price >= 0),
  description        text not null default '',
  created_at         timestamptz not null default now(),
  unique (order_id, position)
);
alter table public.order_items enable row level security;

-- Rows are visible to whoever can see the parent order (orders RLS applies
-- inside the subquery) — the same pattern as order_assignees.
create policy order_items_select on public.order_items
  for select using (exists (select 1 from public.orders o where o.id = order_id));

-- Writes only through create_order(). SELECT on every column except price.
revoke all on public.order_items from anon, authenticated;
grant select (id, order_id, position, product_name, transformer_rating, quantity, description, created_at)
  on public.order_items to authenticated;

-- ── 2. backfill: every existing order is a one-product order ────────────────
insert into public.order_items (order_id, position, product_name, transformer_rating,
                                quantity, price, description, created_at)
select id, 1, product_name, transformer_rating, quantity, price, description, created_at
  from public.orders;

-- ── 3. price-safe reads ────────────────────────────────────────────────────
-- Order value = sum of product values; same viewer rule as before.
create or replace function public.order_price_for_viewer(p_order_id uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select case when public.is_admin_tier() or o.created_by = auth.uid()
              then (select sum(i.price) from public.order_items i where i.order_id = o.id)
              else null end
  from public.orders o
  where o.id = p_order_id
$$;

-- The order's products as JSON, in entry order. Callable directly, so it
-- checks visibility itself (SECURITY DEFINER bypasses RLS): admin tier, the
-- punching account, or an assigned production member. price is null for
-- anyone but admin tier and the punching account.
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
           'description', i.description
         ) order by i.position), '[]'::jsonb)
    from public.orders o
    join public.order_items i on i.order_id = o.id
   where o.id = p_order_id
     and (public.is_admin_tier() or o.created_by = auth.uid() or public.is_order_assignee(o.id))
$$;
revoke all on function public.order_items_for_viewer(uuid) from public, anon;
grant execute on function public.order_items_for_viewer(uuid) to authenticated;

-- Same columns as before, plus `items` at the end (create or replace keeps
-- the grants; the previous app build simply ignores the new column).
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
  public.order_items_for_viewer(o.id) as items
from public.orders o;

-- ── 4. punching an order: items-based create_order ─────────────────────────
-- p_items: [{product_name, transformer_rating, quantity, price|null,
-- description}, ...] — 1 to 20 products, in display order.
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
    if char_length(coalesce(v_item->>'description', '')) > 4000 then
      raise exception 'product %: description is too long (up to 4000 characters)', v_pos;
    end if;
  end loop;

  v_first := p_items->0;
  select sum((e->>'price')::numeric) into v_sum
    from jsonb_array_elements(p_items) e
   where jsonb_typeof(e->'price') = 'number';

  -- orders' product columns mirror the first product; price is the total
  insert into public.orders (created_by, product_name, client_name, transformer_rating,
                             quantity, price, expected_delivery, description, stage, status)
  values (p_created_by, btrim(v_first->>'product_name'), btrim(p_client_name),
          btrim(v_first->>'transformer_rating'), (v_first->>'quantity')::int, v_sum,
          p_expected_delivery, coalesce(v_first->>'description', ''), 1, v_status)
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
revoke all on function public.create_order(uuid, text, date, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.create_order(uuid, text, date, jsonb, uuid[])
  to service_role;

-- Old signature, for the previous app build during the deploy window: now
-- a one-product call to the items-based version. Drop once the new build
-- is live.
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
begin
  return query
  select * from public.create_order(
    p_created_by, p_client_name, p_expected_delivery,
    jsonb_build_array(jsonb_build_object(
      'product_name', p_product_name,
      'transformer_rating', p_transformer_rating,
      'quantity', p_quantity,
      'price', p_price,
      'description', coalesce(p_description, ''))),
    p_assignees);
end $$;
revoke all on function public.create_order(uuid, text, text, text, integer, numeric, date, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.create_order(uuid, text, text, text, integer, numeric, date, text, uuid[])
  to service_role;

-- ── 5. delete audit: snapshot the products; "punched by" ───────────────────
-- BEFORE DELETE on orders, so the products are still there to snapshot (the
-- cascade removes them after). `dispatched_by` keeps its key so older rows
-- and newer rows read the same way.
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
           'price', i.price, 'description', i.description) order by i.position), '[]'),
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

-- ── 6. account archive export: each order carries its products ────────────
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
                                'price', i.price, 'description', i.description) order by i.position), '[]')
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
