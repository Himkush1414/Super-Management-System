-- ============================================================================
-- NR Industries — 0026_api_write_lockdown.sql
--
-- Takes away table write rights the app never uses, so a signed-in session
-- (or the public anon key) can't change data by calling the REST API
-- directly. No table, column, row, policy or function changes; only grants.
--
-- Every write the app makes already goes through the service role or a
-- SECURITY DEFINER function (create_order, advance_order_stage,
-- admin_set_order_stage, activate_ready_orders, the settings upsert, the
-- notification inserts). The only writes made with the user's own session
-- are kept:
--   * orders / order_stage_events: DELETE for admin-tier (the delete
--     buttons, gated by the orders_admin_delete / ose_admin_delete policies);
--   * notifications: UPDATE of read_at only (mark as read).
-- Taken away (audit H-6, L-4):
--   * orders: INSERT, UPDATE (an admin session could PATCH any column of any
--     order, amounts included, with no stage history and no audit row);
--   * order_feed (the security_invoker view over orders): every write;
--   * order_stage_events: INSERT, UPDATE;
--   * production_settings: INSERT, UPDATE, DELETE (production could write its
--     own phone without the format check, and "confirmed");
--   * notifications: INSERT, DELETE, and UPDATE of anything but read_at;
--   * TRUNCATE, REFERENCES and TRIGGER on all of these;
--   * anon: every write on these tables (anon has no policies anyway).
-- SELECT rights are not touched.
--
-- Rollback: grant the same privileges back (listed in the PR).
-- ============================================================================

begin;

revoke insert, update, delete, truncate, references, trigger on public.orders              from anon;
revoke insert, update,         truncate, references, trigger on public.orders              from authenticated;

revoke insert, update, delete, truncate, references, trigger on public.order_feed          from anon, authenticated;

revoke insert, update, delete, truncate, references, trigger on public.order_stage_events  from anon;
revoke insert, update,         truncate, references, trigger on public.order_stage_events  from authenticated;

revoke insert, update, delete, truncate, references, trigger on public.production_settings from anon, authenticated;

revoke insert, update, delete, truncate, references, trigger on public.notifications       from anon;
revoke insert, update, delete, truncate, references, trigger on public.notifications       from authenticated;
grant  update (read_at)                                       on public.notifications       to authenticated;

commit;
