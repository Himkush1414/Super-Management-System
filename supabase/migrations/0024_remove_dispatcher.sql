-- ============================================================================
-- NR Industries — 0024_remove_dispatcher.sql
--
-- The dispatcher feature (0022 / 0023) is removed. A punched order goes
-- straight to its production team again, exactly as before 0023: Stage 1 is
-- "Start", production clicks it to begin (1 -> 2) and the 3-minute timer
-- runs from then on, as always. Everything else 0023 brought stays: the
-- admin / head_admin stage override (any stage, no timer, confirmed in the
-- app) and the rule that the timer is production's only.
--
-- DATA SAFETY: no row is inserted, updated or deleted. Only functions and
-- policies change (supabase/scripts/0024_snapshot.sql before == after).
-- Deliberately kept, so nothing that exists is removed:
--   * the accounts dispatcher1 / dispatcher2, their profiles and PINs — the
--     app no longer lets them sign in (lib/auth/actions.ts, session.ts);
--   * the `dispatcher` value of user_role (Postgres can't drop an enum value);
--   * orders.review_started_at / _by and their order_feed columns (all null:
--     no order was ever opened by a dispatcher). Nothing writes them now.
-- ============================================================================

begin;

-- ── 1. dispatchers see nothing any more ───────────────────────────────────
drop policy if exists orders_dispatcher_all on public.orders;
drop policy if exists profiles_dispatcher_sees on public.profiles;

-- 0021's order_items_for_viewer (no dispatcher clause)
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

-- names: back to marketing / production only (as 0016)
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

-- ── 2. the dispatch step is gone ──────────────────────────────────────────
drop function if exists public.dispatch_order(uuid, uuid);
drop function if exists public.start_order_review(uuid, uuid);
drop function if exists public.is_dispatcher();

-- ── 3. production starts Stage 1 again ────────────────────────────────────
-- 0023's version without `awaiting_dispatch`: production advances 1 -> 2 and
-- every stage after, each advance starting the timer for the next one. The
-- admin branch (no timer) is unchanged.
create or replace function public.advance_order_stage(
  p_order_id      uuid,
  p_actor         uuid,
  p_from_stage    smallint,
  p_timer_seconds int
)
returns table (
  outcome           text,      -- ok | not_found | not_assigned | waiting | delivered | timer | stale
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

-- ── 4. admin / head_admin: any stage, no restrictions (unchanged, minus the
--       dispatch-review reset when moving back to Stage 1) ─────────────────
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
         stage_ready_at = null
   where id = o.id;
  insert into public.order_stage_events (order_id, from_stage, to_stage, changed_by)
  values (o.id, o.stage, p_to_stage, p_actor);

  return query select 'ok'::text, p_to_stage, o.created_by, o.product_name, o.whatsapp_group_id, v_assignees;
end $$;
revoke all on function public.admin_set_order_stage(uuid, uuid, smallint, smallint) from public, anon, authenticated;
grant execute on function public.admin_set_order_stage(uuid, uuid, smallint, smallint) to service_role;

commit;
