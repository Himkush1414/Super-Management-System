-- ============================================================================
-- NR Industries — clear_test_orders.sql   (one-off data cleanup, NOT a migration)
--
-- Removes the order data that was entered randomly while testing, so the
-- system starts clean. Accounts are untouched.
--
--   DELETES   public.orders               every row
--             public.order_stage_events   every row (cascades from orders)
--             public.order_assignees      every row (cascades from orders; 0012+)
--             public.notifications        rows about orders (entity_type = 'order')
--
--   KEEPS     auth.users / public.profiles   the 10 fixed accounts
--             public.production_settings     registered WhatsApp numbers
--             public.audit_log               (0013+) — and this cleanup is
--                                             itself recorded there when the
--                                             audit triggers exist
--
-- Works on the schema both before and after migration 0012. Runs in one
-- transaction: either everything above is removed or nothing is. Prints the
-- row counts it removed.
-- ============================================================================

begin;

do $$
declare
  n_orders int;
  n_events int;
  n_notifs int;
begin
  select count(*) into n_orders from public.orders;
  select count(*) into n_events from public.order_stage_events;
  select count(*) into n_notifs from public.notifications where entity_type = 'order';

  delete from public.notifications where entity_type = 'order';
  delete from public.orders;  -- order_stage_events / order_assignees cascade

  raise notice 'clear_test_orders: removed % orders, % stage events, % notifications',
    n_orders, n_events, n_notifs;
end $$;

commit;
