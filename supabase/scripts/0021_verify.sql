-- ============================================================================
-- NR Industries — supabase/scripts/0021_verify.sql   (NOT a migration)
-- Read-only checks to run right after 0021 is applied. Every row must say ok.
-- Data safety is checked separately: 0021_snapshot.sql before == after.
-- ============================================================================
select check_name, ok from (values
  ('0021 recorded in schema_migrations',
     exists (select 1 from supabase_migrations.schema_migrations where version = '0021')),
  ('orders.ship_to + orders.additional_amount exist',
     (select count(*) = 2 from information_schema.columns
       where table_schema = 'public' and table_name = 'orders'
         and column_name in ('ship_to', 'additional_amount'))),
  ('order_items.feat still exists (kept, untouched)',
     exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'order_items' and column_name = 'feat')),
  ('authenticated can SELECT orders.ship_to',
     has_column_privilege('authenticated', 'public.orders', 'ship_to', 'SELECT')),
  ('authenticated cannot SELECT orders.additional_amount',
     not has_column_privilege('authenticated', 'public.orders', 'additional_amount', 'SELECT')),
  ('anon cannot SELECT orders.additional_amount',
     not has_column_privilege('anon', 'public.orders', 'additional_amount', 'SELECT')),
  ('authenticated still cannot SELECT orders.price / order_items.price / feat',
     not has_column_privilege('authenticated', 'public.orders', 'price', 'SELECT')
     and not has_column_privilege('authenticated', 'public.order_items', 'price', 'SELECT')
     and not has_column_privilege('authenticated', 'public.order_items', 'feat', 'SELECT')),
  ('gst_of(100) = 18.00 and gst_of(0.25) = 0.05',
     public.gst_of(100) = 18.00 and public.gst_of(0.25) = 0.05),
  ('orders with an Additional Amount: stored price = Σ(price + GST) + additional',
     not exists (select 1 from public.orders o
                  where o.additional_amount is not null
                    and o.price is distinct from
                        (select coalesce(sum(i.price + public.gst_of(i.price)), 0)
                                + coalesce(o.additional_amount, 0)
                           from public.order_items i where i.order_id = o.id))),
  ('only service_role can call create_order (7-arg)',
     has_function_privilege('service_role', 'public.create_order(uuid,text,text,date,jsonb,numeric,uuid[])', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.create_order(uuid,text,text,date,jsonb,numeric,uuid[])', 'EXECUTE')
     and not has_function_privilege('anon', 'public.create_order(uuid,text,text,date,jsonb,numeric,uuid[])', 'EXECUTE')),
  ('the 0020 5-arg create_order is still there for the deploy window',
     to_regprocedure('public.create_order(uuid,text,date,jsonb,uuid[])') is not null),
  ('only service_role can call advance_order_stage',
     not has_function_privilege('authenticated', 'public.advance_order_stage(uuid,uuid,smallint,int)', 'EXECUTE')),
  ('API roles cannot call order_additional_amount (unfiltered)',
     not has_function_privilege('authenticated', 'public.order_additional_amount(uuid)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.order_additional_amount(uuid)', 'EXECUTE')),
  ('anon cannot call order_additional_for_viewer',
     not has_function_privilege('anon', 'public.order_additional_for_viewer(uuid)', 'EXECUTE'))
) t(check_name, ok);
