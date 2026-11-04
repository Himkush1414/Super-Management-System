-- ============================================================================
-- NR Industries — supabase/scripts/0026_verify.sql   (NOT a migration)
-- Read-only checks right after 0026. Every row must say ok (true).
-- Data safety: run 0024_snapshot.sql before and after; it must be identical.
-- ============================================================================
select check_name, ok from (values
  ('0026 recorded in schema_migrations',
     (select count(*) = 1 from supabase_migrations.schema_migrations where version = '0026')),
  ('orders: API roles can no longer INSERT or UPDATE',
     not has_table_privilege('authenticated', 'public.orders', 'INSERT')
     and not has_table_privilege('authenticated', 'public.orders', 'UPDATE')
     and not has_table_privilege('anon', 'public.orders', 'INSERT,UPDATE,DELETE')),
  ('orders / order_stage_events: admin DELETE (the delete buttons) is kept',
     has_table_privilege('authenticated', 'public.orders', 'DELETE')
     and has_table_privilege('authenticated', 'public.order_stage_events', 'DELETE')),
  ('order_feed: read only',
     has_table_privilege('authenticated', 'public.order_feed', 'SELECT')
     and not has_table_privilege('authenticated', 'public.order_feed', 'INSERT,UPDATE,DELETE')),
  ('order_stage_events: no INSERT / UPDATE from the API',
     not has_table_privilege('authenticated', 'public.order_stage_events', 'INSERT,UPDATE')),
  ('production_settings: read only for API roles',
     has_table_privilege('authenticated', 'public.production_settings', 'SELECT')
     and not has_table_privilege('authenticated', 'public.production_settings', 'INSERT,UPDATE,DELETE')),
  ('notifications: only read_at can be updated (mark as read)',
     has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE')
     and not has_column_privilege('authenticated', 'public.notifications', 'title', 'UPDATE')
     and not has_table_privilege('authenticated', 'public.notifications', 'INSERT,DELETE')),
  ('no TRUNCATE for API roles on these tables',
     not has_table_privilege('authenticated', 'public.orders', 'TRUNCATE')
     and not has_table_privilege('authenticated', 'public.notifications', 'TRUNCATE')
     and not has_table_privilege('authenticated', 'public.production_settings', 'TRUNCATE')
     and not has_table_privilege('authenticated', 'public.order_stage_events', 'TRUNCATE')),
  ('price / additional_amount still not selectable by API roles',
     not has_column_privilege('authenticated', 'public.orders', 'price', 'SELECT')
     and not has_column_privilege('authenticated', 'public.orders', 'additional_amount', 'SELECT'))
) v(check_name, ok);
