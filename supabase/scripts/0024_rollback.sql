-- ============================================================================
-- NR Industries — supabase/scripts/0024_rollback.sql   (NOT a migration)
--
-- Puts the dispatcher feature back: re-runs 0023's functions and policies
-- verbatim (0023 is idempotent — `if not exists`, `create or replace`,
-- `drop policy if exists`). No row is inserted, updated or deleted, and the
-- schema_migrations row for 0024 is left alone. The app must be rolled back
-- to a pre-0024 build as well.
-- ============================================================================

begin;

-- ── 1. columns (additive) ──────────────────────────────────────────────────
alter table public.orders
  add column if not exists review_started_at timestamptz,
  add column if not exists review_started_by uuid references public.profiles(id) on delete set null;
grant select (review_started_at, review_started_by) on public.orders to authenticated;

-- ── 2. names: dispatchers have real names too ("Asha (Dispatcher 1)") ──────
create or replace function public.display_name(p_profile_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case
           when p.role in ('marketing', 'production', 'dispatcher') and p.real_name is not null
             then p.real_name || ' (' || p.full_name || ')'
           else p.full_name
         end
    from public.profiles p
   where p.id = p_profile_id
$$;

-- ── 3. visibility ──────────────────────────────────────────────────────────
create or replace function public.is_dispatcher()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() = 'dispatcher', false)
$$;

-- every order, read-only (order_items / order_assignees / order_stage_events
-- policies follow the orders policy through their EXISTS subqueries)
drop policy if exists orders_dispatcher_all on public.orders;
create policy orders_dispatcher_all on public.orders
  for select using (public.is_dispatcher());

drop policy if exists profiles_dispatcher_sees on public.profiles;
create policy profiles_dispatcher_sees on public.profiles
  for select using (public.is_dispatcher() and role in ('marketing', 'production', 'dispatcher'));

-- products: dispatchers may read them; price / GST stay null for them
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
     and (public.is_admin_tier() or o.created_by = auth.uid() or public.is_order_assignee(o.id)
          or public.is_dispatcher())
$$;

-- Same columns as 0021, plus the review columns at the end.
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
  public.order_additional_for_viewer(o.id) as additional_amount,
  o.review_started_at,
  o.review_started_by
from public.orders o;

-- ── 4. Stage 1: "Start" -> "Verification in progress" ─────────────────────
-- Called when a dispatcher opens a Stage 1 order. Marks it once; true when
-- this call did it.
create or replace function public.start_order_review(p_order_id uuid, p_actor uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if not exists (select 1 from public.profiles where id = p_actor and role = 'dispatcher') then
    return false;
  end if;
  update public.orders
     set review_started_at = now(), review_started_by = p_actor
   where id = p_order_id and stage = 1 and review_started_at is null;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.start_order_review(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_order_review(uuid, uuid) to service_role;

-- ── 5. Stage 1 -> 2: the dispatcher's "Dispatch to production" ─────────────
create or replace function public.dispatch_order(p_order_id uuid, p_actor uuid)
returns table (
  outcome           text,      -- ok | not_found | not_permitted | waiting | already
  stage             smallint,  -- the order's stage after the call
  created_by        uuid,
  product_name      text,
  whatsapp_group_id text,
  assignee_ids      uuid[],
  by_label          text       -- who moved it out of Stage 1 (outcome already)
)
language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  v_assignees uuid[];
  v_by text;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    return query select 'not_found'::text, null::smallint, null::uuid, null::text, null::text, null::uuid[], null::text;
    return;
  end if;
  select array_agg(a.profile_id) into v_assignees from public.order_assignees a where a.order_id = o.id;

  if not exists (select 1 from public.profiles where id = p_actor and role = 'dispatcher') then
    outcome := 'not_permitted';
  elsif o.stage <> 1 then
    outcome := 'already';
    select public.display_name(e.changed_by) into v_by
      from public.order_stage_events e
     where e.order_id = o.id and e.from_stage = 1 and e.to_stage = 2
     order by e.created_at desc limit 1;
  elsif o.status <> 'active' then
    outcome := 'waiting';
  else
    outcome := 'ok';
  end if;

  if outcome <> 'ok' then
    return query select outcome, o.stage, o.created_by, o.product_name, o.whatsapp_group_id, v_assignees, v_by;
    return;
  end if;

  -- no timer: production may start Stage 2 -> 3 straight away
  update public.orders set stage = 2, stage_ready_at = null where id = o.id;
  insert into public.order_stage_events (order_id, from_stage, to_stage, changed_by)
  values (o.id, 1, 2, p_actor);

  return query select 'ok'::text, 2::smallint, o.created_by, o.product_name, o.whatsapp_group_id, v_assignees, null::text;
end $$;
revoke all on function public.dispatch_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.dispatch_order(uuid, uuid) to service_role;

-- ── 6. production: Stage 1 belongs to the dispatchers ─────────────────────
-- Same signature and outcomes as 0021 plus `awaiting_dispatch`. The admin
-- branch stays for the previous app build during the deploy window; this
-- build uses admin_set_order_stage instead.
create or replace function public.advance_order_stage(
  p_order_id      uuid,
  p_actor         uuid,
  p_from_stage    smallint,
  p_timer_seconds int
)
returns table (
  outcome           text,      -- ok | not_found | not_assigned | waiting | delivered | timer | stale | awaiting_dispatch
  stage             smallint,
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
    when not v_admin and o.stage = 1                       then 'awaiting_dispatch'
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
         -- the timer is production's only: an admin advance starts none
         stage_ready_at = case when v_to < 5 and not v_admin then now() + make_interval(secs => p_timer_seconds) end
   where id = o.id;

  insert into public.order_stage_events (order_id, from_stage, to_stage, changed_by)
  values (o.id, o.stage, v_to, p_actor);

  return query select 'ok'::text, v_to, o.created_by, o.product_name, o.whatsapp_group_id, v_assignees;
end $$;
revoke all on function public.advance_order_stage(uuid, uuid, smallint, int) from public, anon, authenticated;
grant execute on function public.advance_order_stage(uuid, uuid, smallint, int) to service_role;

-- ── 7. admin / head_admin: any stage, no restrictions ──────────────────────
create or replace function public.admin_set_order_stage(
  p_order_id   uuid,
  p_actor      uuid,
  p_from_stage smallint,
  p_to_stage   smallint
)
returns table (
  outcome           text,      -- ok | not_found | not_permitted | invalid | stale
  stage             smallint,
  created_by        uuid,
  product_name      text,
  whatsapp_group_id text,
  assignee_ids      uuid[]
)
language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  v_assignees uuid[];
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    return query select 'not_found'::text, null::smallint, null::uuid, null::text, null::text, null::uuid[];
    return;
  end if;
  select array_agg(a.profile_id) into v_assignees from public.order_assignees a where a.order_id = o.id;

  outcome := case
    when not exists (select 1 from public.profiles p
                      where p.id = p_actor and p.role in ('admin', 'head_admin')) then 'not_permitted'
    when p_to_stage is null or p_to_stage not between 1 and 5 or p_to_stage = o.stage then 'invalid'
    when o.stage <> p_from_stage then 'stale'
    else 'ok'
  end;
  if outcome <> 'ok' then
    return query select outcome, o.stage, o.created_by, o.product_name, o.whatsapp_group_id, v_assignees;
    return;
  end if;

  update public.orders
     set stage = p_to_stage,
         -- admin moves start no timer (and clear a running one)
         stage_ready_at = null,
         -- back in Stage 1: the dispatchers see it as "Start" again
         review_started_at = case when p_to_stage = 1 then null else review_started_at end,
         review_started_by = case when p_to_stage = 1 then null else review_started_by end
   where id = o.id;
  insert into public.order_stage_events (order_id, from_stage, to_stage, changed_by)
  values (o.id, o.stage, p_to_stage, p_actor);

  return query select 'ok'::text, p_to_stage, o.created_by, o.product_name, o.whatsapp_group_id, v_assignees;
end $$;
revoke all on function public.admin_set_order_stage(uuid, uuid, smallint, smallint) from public, anon, authenticated;
grant execute on function public.admin_set_order_stage(uuid, uuid, smallint, smallint) to service_role;

commit;
