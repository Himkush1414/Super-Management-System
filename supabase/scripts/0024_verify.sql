-- ============================================================================
-- NR Industries — supabase/scripts/0024_verify.sql   (NOT a migration)
-- Read-only checks right after 0024. Every row must say ok. Data safety:
-- 0024_snapshot.sql before == after.
-- ============================================================================
select check_name, ok from (values
  ('0024 recorded in schema_migrations',
     (select count(*) = 1 from supabase_migrations.schema_migrations where version = '0024')),
  ('dispatch_order / start_order_review / is_dispatcher are gone',
     to_regprocedure('public.dispatch_order(uuid,uuid)') is null
     and to_regprocedure('public.start_order_review(uuid,uuid)') is null
     and to_regprocedure('public.is_dispatcher()') is null),
  ('dispatcher policies are gone',
     (select count(*) = 0 from pg_policy where polname in ('orders_dispatcher_all', 'profiles_dispatcher_sees'))),
  ('advance_order_stage: production may leave Stage 1 again (no awaiting_dispatch)',
     (select prosrc not like '%awaiting_dispatch%' from pg_proc where oid = 'public.advance_order_stage(uuid,uuid,smallint,int)'::regprocedure)),
  ('advance_order_stage / admin_set_order_stage: service_role only',
     has_function_privilege('service_role', 'public.advance_order_stage(uuid,uuid,smallint,int)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.advance_order_stage(uuid,uuid,smallint,int)', 'EXECUTE')
     and has_function_privilege('service_role', 'public.admin_set_order_stage(uuid,uuid,smallint,smallint)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.admin_set_order_stage(uuid,uuid,smallint,smallint)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.admin_set_order_stage(uuid,uuid,smallint,smallint)', 'EXECUTE')),
  ('price / additional_amount still not selectable by API roles',
     not has_column_privilege('authenticated', 'public.orders', 'price', 'SELECT')
     and not has_column_privilege('authenticated', 'public.orders', 'additional_amount', 'SELECT')
     and not has_column_privilege('authenticated', 'public.order_items', 'price', 'SELECT')),
  ('dispatcher1 + dispatcher2 still exist, with their PINs',
     (select count(*) = 2 from public.profiles p join public.account_pins ap on ap.profile_id = p.id
       where p.username in ('dispatcher1', 'dispatcher2') and p.role = 'dispatcher')),
  ('order_items_for_viewer / display_name no longer mention dispatchers',
     (select bool_and(prosrc not like '%dispatcher%') from pg_proc
       where oid in ('public.order_items_for_viewer(uuid)'::regprocedure, 'public.display_name(uuid)'::regprocedure)))
) t(check_name, ok);
