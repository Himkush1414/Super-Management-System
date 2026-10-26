-- ============================================================================
-- NR Management (mobile app) — rollback.sql
-- Turns new-order push notifications OFF. That is all it does: it removes
-- only the trigger this feature added. Every table and every row (orders,
-- device_tokens, order_push_log, everything else) is kept. Re-running
-- 002_new_order_push.sql turns notifications back on.
-- ============================================================================
begin;
drop trigger if exists orders_new_order_push on public.orders;
commit;
