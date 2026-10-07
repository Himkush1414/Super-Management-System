-- ============================================================================
-- NR Industries — supabase/scripts/0023_verify.sql   (NOT a migration)
-- Read-only checks right after 0022 + 0023 (+ hosted-dispatchers.sql).
-- Every row must say ok. Data safety: 0021_snapshot.sql before == after.
-- ============================================================================
select check_name, ok from (values
  ('0022 + 0023 recorded in schema_migrations',
     (select count(*) = 2 from supabase_migrations.schema_migrations where version in ('0022', '0023'))),
  ('user_role has dispatcher',
     'dispatcher' = any(enum_range(null::public.user_role)::text[])),
  ('dispatcher1 + dispatcher2 exist with role dispatcher and a PIN',
     (select count(*) = 2 from public.profiles p join public.account_pins ap on ap.profile_id = p.id
       where p.username in ('dispatcher1', 'dispatcher2') and p.role = 'dispatcher')),
  ('orders.review_started_at / _by exist and are readable',
     has_column_privilege('authenticated', 'public.orders', 'review_started_at', 'SELECT')
     and has_column_privilege('authenticated', 'public.orders', 'review_started_by', 'SELECT')),
  ('price / additional_amount still not selectable by API roles',
     not has_column_privilege('authenticated', 'public.orders', 'price', 'SELECT')
     and not has_column_privilege('authenticated', 'public.orders', 'additional_amount', 'SELECT')
     and not has_column_privilege('authenticated', 'public.order_items', 'price', 'SELECT')),
  ('dispatcher policies on orders + profiles',
     (select count(*) = 2 from pg_policy where polname in ('orders_dispatcher_all', 'profiles_dispatcher_sees'))),
  ('dispatch_order / start_order_review / admin_set_order_stage: service_role only',
     has_function_privilege('service_role', 'public.dispatch_order(uuid,uuid)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.dispatch_order(uuid,uuid)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.start_order_review(uuid,uuid)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.admin_set_order_stage(uuid,uuid,smallint,smallint,integer)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.dispatch_order(uuid,uuid)', 'EXECUTE')),
  ('advance_order_stage still service_role only',
     not has_function_privilege('authenticated', 'public.advance_order_stage(uuid,uuid,smallint,int)', 'EXECUTE')),
  ('order_feed has review columns',
     (select count(*) = 2 from information_schema.columns
       where table_name = 'order_feed' and column_name in ('review_started_at', 'review_started_by')))
) t(check_name, ok);
