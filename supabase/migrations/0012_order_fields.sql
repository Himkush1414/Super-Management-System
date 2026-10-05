-- ============================================================================
-- NR Industries — 0012_order_fields.sql
--
-- New order-entry fields and multi-member production assignment.
--
--   Fields     product name · client name · transformer rating · quantity ·
--              order value (`price`, same column, same lockdown as 0010) ·
--              expected delivery date · description
--   Removed    quality, power_type (replaced by transformer_rating),
--              production_phone (numbers are read live from
--              production_settings instead of snapshotted per order)
--   Assignment `orders.assigned_to` (exactly one production account) becomes
--              `order_assignees` — marketing picks one or more specific
--              production members per order, never a broadcast.
--
-- Status rule, generalised from one assignee to several: an order is
-- `active` once EVERY assigned member has a confirmed phone (the WhatsApp
-- group is created with all of them); until then it stays
-- `waiting_on_production_phone`.
--
-- Writes to orders / order_assignees / order_stage_events go only through
-- server actions (service role, session-checked) or create_order() below.
-- The direct-write policies 0008 left in place — production could PATCH any
-- column of its order (price included) and forge stage history through
-- PostgREST; marketing could insert rows that skipped the phone gating — are
-- dropped here rather than carried over.
-- ============================================================================

begin;

-- ── 1. drop what depends on the columns being replaced ─────────────────────
drop view if exists public.order_feed;
drop policy if exists orders_production_assigned on public.orders;
drop policy if exists orders_production_update  on public.orders;
drop policy if exists orders_marketing_insert   on public.orders;
drop policy if exists ose_insert                on public.order_stage_events;

-- ── 2. new order fields ────────────────────────────────────────────────────
alter table public.orders
  add column client_name        text not null default '',
  add column transformer_rating text not null default '',
  add column expected_delivery  date;

update public.orders
   set transformer_rating = power_type
 where transformer_rating = '' and power_type <> '';

-- 0010 replaced the table-wide SELECT grant with a column list that leaves
-- `price` out; columns added afterwards need to be granted explicitly.
grant select (client_name, transformer_rating, expected_delivery)
  on public.orders to authenticated;

-- ── 3. assignees: one order -> one or more production members ──────────────
create table public.order_assignees (
  order_id   uuid not null references public.orders(id)   on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (order_id, profile_id)
);
create index order_assignees_profile_idx on public.order_assignees(profile_id);
alter table public.order_assignees enable row level security;

insert into public.order_assignees (order_id, profile_id)
select id, assigned_to from public.orders;

-- Only production accounts can be assigned.
create or replace function public.guard_order_assignee()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles
                 where id = new.profile_id and role = 'production') then
    raise exception 'orders can only be assigned to production accounts';
  end if;
  return new;
end $$;
create trigger guard_order_assignee before insert or update on public.order_assignees
  for each row execute function public.guard_order_assignee();

alter table public.orders
  drop column assigned_to,
  drop column quality,
  drop column power_type,
  drop column production_phone;

-- ── 4. RLS ─────────────────────────────────────────────────────────────────
-- Security definer so the orders policy can consult order_assignees without
-- re-entering order_assignees' own policy (which consults orders).
create or replace function public.is_order_assignee(p_order_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.order_assignees
                 where order_id = p_order_id and profile_id = auth.uid())
$$;

create policy orders_production_assigned on public.orders
  for select using (public.is_order_assignee(id));

-- Assignee rows are visible to whoever can see the parent order.
create policy order_assignees_select on public.order_assignees
  for select using (exists (select 1 from public.orders o where o.id = order_id));

revoke insert, update, delete, truncate on public.order_assignees from anon, authenticated;

-- ── 5. price-safe read view ────────────────────────────────────────────────
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

-- ── 6. atomic dispatch ─────────────────────────────────────────────────────
-- The order and its assignees are written in one transaction, so a realtime
-- subscriber (or a crash between two requests) never sees an order with no
-- assignees. Called by the dispatchOrder server action with the service
-- role, after it has checked the caller's session is a marketing account.
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

  p_assignees := array(select distinct unnest(p_assignees));
  v_total := coalesce(array_length(p_assignees, 1), 0);
  if v_total = 0 then
    raise exception 'choose at least one production member';
  end if;

  select count(*) into v_ready
    from public.production_settings s
   where s.profile_id = any(p_assignees)
     and s.phone is not null and s.confirmed_at is not null;
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

-- ── 7. realtime ────────────────────────────────────────────────────────────
-- Production's list subscribes to its own assignee rows: a new assignment is
-- the event that means "a new order is visible to you".
do $$ begin
  execute 'alter publication supabase_realtime add table public.order_assignees';
exception when duplicate_object then null; end $$;

commit;
