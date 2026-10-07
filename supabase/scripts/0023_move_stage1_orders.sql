-- ============================================================================
-- NR Industries — supabase/scripts/0023_move_stage1_orders.sql   (NOT a migration)
--
-- One-off, approved by the owner 2026-10-07, run once right after 0023:
-- every order at Stage 1 moves to Stage 2 (dispatch review is skipped for
-- orders punched before dispatchers existed) — EXCEPT an order with an
-- assigned production member who has no phone number linked; it stays at
-- Stage 1 for a dispatcher once the number is added.
--
-- Changes ONLY orders.stage (1 -> 2), orders.stage_ready_at (null: no
-- timer, production may start Stage 2 -> 3 at once) and orders.updated_at
-- (touch trigger) of the moved orders, and adds one stage-history row per
-- moved order (1 -> 2, changed_by null = system). Nothing else.
-- Check: 0023_move_check.sql before == after. Preview: 0023_stage1_preview.sql.
-- Reverse: 0023_move_stage1_rollback.sql.
-- ============================================================================
begin;

with movable as (
  select o.id
    from public.orders o
   where o.stage = 1
     and not exists (select 1 from public.order_assignees a
                       left join public.production_settings s on s.profile_id = a.profile_id
                      where a.order_id = o.id and (s.phone is null or s.confirmed_at is null))
),
moved as (
  update public.orders o
     set stage = 2, stage_ready_at = null
    from movable m
   where o.id = m.id
  returning o.id
)
insert into public.order_stage_events (order_id, from_stage, to_stage, changed_by)
select id, 1, 2, null from moved;

select 'moved to Stage 2' as what, count(*) as orders
  from public.order_stage_events where from_stage = 1 and to_stage = 2 and changed_by is null
union all
select 'still at Stage 1', count(*) from public.orders where stage = 1;

commit;
