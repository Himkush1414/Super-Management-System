-- ============================================================================
-- NR Industries — supabase/scripts/0028_verify.sql   (NOT a migration)
-- READ-ONLY. Run after 0027 + 0028: every row must say ok = true.
-- Checks the role value, the inv_ tables' RLS and grants, who may call
-- which function, and that the append-only triggers are in place.
-- ============================================================================
with t(name) as (values ('inv_columns'), ('inv_products'), ('inv_transactions'), ('inv_month_snapshots'),
                        ('inv_closed_months'), ('inv_settings'), ('inv_product_log'))
select 'user_role has inventory and every earlier value' as check,
       (select array_agg(enumlabel::text order by enumsortorder) from pg_enum where enumtypid = 'public.user_role'::regtype)
         @> array['head_admin', 'admin', 'marketing', 'production', 'dispatcher', 'inventory'] as ok
union all
select 'all 7 inv_ tables exist with RLS on',
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname in (select name from t) and c.relrowsecurity) = 7
union all
select 'one read policy per inv_ table, none for writing',
       (select count(*) from pg_policies where schemaname = 'public' and tablename in (select name from t) and cmd = 'SELECT') = 7
       and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in (select name from t) and cmd <> 'SELECT')
union all
select 'anon has no table rights on inv_ tables',
       not exists (select 1 from t where has_table_privilege('anon', 'public.' || name, 'select,insert,update,delete,truncate'))
union all
select 'authenticated may only SELECT inv_ tables',
       (select bool_and(has_table_privilege('authenticated', 'public.' || name, 'select')
                        and not has_table_privilege('authenticated', 'public.' || name, 'insert,update,delete,truncate')) from t)
union all
select 'anon may call no inv_ function',
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname like 'inv\_%' and has_function_privilege('anon', p.oid, 'execute'))
union all
select 'only the service role may run the import',
       not has_function_privilege('authenticated', 'public.inv_import_products(jsonb)', 'execute')
       and has_function_privilege('service_role', 'public.inv_import_products(jsonb)', 'execute')
union all
select 'write functions are security definer and check the role',
       (select bool_and(p.prosecdef and p.prosrc like '%inv_can_manage()%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('inv_record_transaction', 'inv_reverse_transaction', 'inv_add_product',
               'inv_update_product', 'inv_set_product_active', 'inv_save_settings', 'inv_add_column', 'inv_update_column',
               'inv_reorder_columns', 'inv_set_column_archived'))
union all
select 'append-only triggers on the ledger and history',
       (select count(*) from pg_trigger where not tgisinternal and tgname like 'inv\_%') >= 15
union all
select 'the 8 default columns exist',
       (select count(*) from public.inv_columns where is_default) = 8;
