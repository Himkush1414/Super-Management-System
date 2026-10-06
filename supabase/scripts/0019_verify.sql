-- ============================================================================
-- NR Industries — supabase/scripts/0019_verify.sql   (NOT a migration)
-- Read-only checks to run right after 0019 is applied. Every row must say ok.
-- ============================================================================
select check_name, ok from (values
  ('0019 recorded in schema_migrations',
     exists (select 1 from supabase_migrations.schema_migrations where version = '0019')),
  ('every order has at least one product',
     not exists (select 1 from public.orders o where not exists (select 1 from public.order_items i where i.order_id = o.id))),
  ('every order total = sum of its products',
     not exists (select 1 from public.orders o
                  where o.price is distinct from (select sum(i.price) from public.order_items i where i.order_id = o.id))),
  ('product positions are 1..n per order',
     not exists (select 1 from (select order_id, max(position) mx, count(*) n from public.order_items group by order_id) x where mx <> n)),
  ('RLS enabled on order_items',
     (select relrowsecurity from pg_class where oid = 'public.order_items'::regclass)),
  ('authenticated cannot SELECT order_items.price',
     not has_column_privilege('authenticated', 'public.order_items', 'price', 'SELECT')),
  ('authenticated cannot write order_items',
     not (has_table_privilege('authenticated', 'public.order_items', 'INSERT')
          or has_table_privilege('authenticated', 'public.order_items', 'UPDATE')
          or has_table_privilege('authenticated', 'public.order_items', 'DELETE'))),
  ('anon cannot read order_items',
     not has_table_privilege('anon', 'public.order_items', 'SELECT')
     and not has_column_privilege('anon', 'public.order_items', 'product_name', 'SELECT')),
  ('anon cannot call order_items_for_viewer',
     not has_function_privilege('anon', 'public.order_items_for_viewer(uuid)', 'EXECUTE')),
  ('authenticated can call order_items_for_viewer',
     has_function_privilege('authenticated', 'public.order_items_for_viewer(uuid)', 'EXECUTE')),
  ('only service_role can call the new create_order',
     has_function_privilege('service_role', 'public.create_order(uuid,text,date,jsonb,uuid[])', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.create_order(uuid,text,date,jsonb,uuid[])', 'EXECUTE')
     and not has_function_privilege('anon', 'public.create_order(uuid,text,date,jsonb,uuid[])', 'EXECUTE')),
  ('order_feed exposes items',
     exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'order_feed' and column_name = 'items'))
) t(check_name, ok);

select (select count(*) from public.orders) as orders,
       (select count(*) from public.order_items) as products;
