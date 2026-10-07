-- ============================================================================
-- NR Industries — supabase/scripts/0023_rollback.sql   (NOT a migration)
--
-- Back to 0021 behaviour WITHOUT deleting data: advance_order_stage and
-- order_items_for_viewer are copied verbatim from 0021, display_name from
-- 0016; the dispatcher policies and functions are dropped. KEPT: the
-- review_started_at / _by columns and their values, order_feed's two extra
-- columns (the 0021 build ignores them), the `dispatcher` enum value (Postgres
-- can't drop one) and the two dispatcher accounts — with no policies left
-- they can see no orders. Run 0023_move_stage1_rollback.sql first if the
-- Stage 1 move should be undone too.
-- ============================================================================

begin;

drop policy if exists orders_dispatcher_all on public.orders;
drop policy if exists profiles_dispatcher_sees on public.profiles;

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

drop function if exists public.dispatch_order(uuid, uuid);
drop function if exists public.start_order_review(uuid, uuid);
drop function if exists public.admin_set_order_stage(uuid, uuid, smallint, smallint);
drop function if exists public.is_dispatcher();

delete from supabase_migrations.schema_migrations where version in ('0022', '0023');

commit;
