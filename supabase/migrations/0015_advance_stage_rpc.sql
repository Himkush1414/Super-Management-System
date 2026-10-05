-- ============================================================================
-- NR Industries — 0015_advance_stage_rpc.sql
--
-- Stage advance in ONE round trip, atomically. The server action used to
-- read the order, update it, and write the history row in a later
-- background call — three trips to the database (each one a cross-region
-- hop in production) and a window where the re-rendered page showed the new
-- stage without its history entry. advance_order_stage() checks everything,
-- moves the stage and records the event in one transaction, under a row
-- lock, and only if the order is still at the stage the user was looking
-- at (no double-advance from two assignees or a stale tab).
--
-- Called by the advanceStage server action with the service role, after it
-- has checked the session is a production account.
-- ============================================================================

begin;

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

commit;
