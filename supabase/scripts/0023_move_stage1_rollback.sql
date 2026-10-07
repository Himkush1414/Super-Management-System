-- ============================================================================
-- NR Industries — supabase/scripts/0023_move_stage1_rollback.sql   (NOT a migration)
-- Puts every order the move took to Stage 2 — and that is STILL at Stage 2 —
-- back at Stage 1, adding a 2 -> 1 system history row (nothing is deleted).
-- Orders production has advanced since are left alone.
-- ============================================================================
begin;

with back as (
  update public.orders o
     set stage = 1, stage_ready_at = null
   where o.stage = 2
     and exists (select 1 from public.order_stage_events e
                  where e.order_id = o.id and e.from_stage = 1 and e.to_stage = 2 and e.changed_by is null)
  returning o.id
)
insert into public.order_stage_events (order_id, from_stage, to_stage, changed_by)
select id, 2, 1, null from back;

commit;
