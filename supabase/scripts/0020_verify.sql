-- ============================================================================
-- NR Industries — supabase/scripts/0020_verify.sql   (NOT a migration)
-- Read-only checks to run right after 0020 is applied. Every row must say ok.
-- ============================================================================
select check_name, ok from (values
  ('0020 recorded in schema_migrations',
     exists (select 1 from supabase_migrations.schema_migrations where version = '0020')),
  ('order_items.feat exists',
     exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'order_items' and column_name = 'feat')),
  ('authenticated cannot SELECT order_items.feat',
     not has_column_privilege('authenticated', 'public.order_items', 'feat', 'SELECT')),
  ('anon cannot SELECT order_items.feat',
     not has_column_privilege('anon', 'public.order_items', 'feat', 'SELECT')),
  ('authenticated still cannot SELECT order_items.price',
     not has_column_privilege('authenticated', 'public.order_items', 'price', 'SELECT')),
  ('every order total = sum of its products price + FEAT',
     not exists (select 1 from public.orders o
                  where o.price is distinct from
                        (select case when count(i.price) + count(i.feat) = 0 then null
                                     else coalesce(sum(i.price), 0) + coalesce(sum(i.feat), 0) end
                           from public.order_items i where i.order_id = o.id))),
  ('only service_role can call create_order (items)',
     has_function_privilege('service_role', 'public.create_order(uuid,text,date,jsonb,uuid[])', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.create_order(uuid,text,date,jsonb,uuid[])', 'EXECUTE')
     and not has_function_privilege('anon', 'public.create_order(uuid,text,date,jsonb,uuid[])', 'EXECUTE')),
  ('anon cannot call order_items_for_viewer',
     not has_function_privilege('anon', 'public.order_items_for_viewer(uuid)', 'EXECUTE'))
) t(check_name, ok);
