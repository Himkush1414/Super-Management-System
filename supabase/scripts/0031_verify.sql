-- ============================================================================
-- NR Industries — supabase/scripts/0031_verify.sql   (NOT a migration)
-- READ-ONLY. Run after 0031: every row must say ok = true.
-- Checks the 0031 tables (RLS, grants, append-only triggers), who may call
-- which function, that the earlier functions are still there, and that no
-- existing row was touched (no stock count, no 0031 snapshot yet).
-- ============================================================================
with t(name) as (values ('inv_count_settings'), ('inv_stock_counts'), ('inv_month_snapshots2'), ('inv_closed_months2'))
select 'the 4 new inv_ tables exist with RLS on' as check,
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname in (select name from t) and c.relrowsecurity) = 4 as ok
union all
select 'one read policy per new table, none for writing',
       (select count(*) from pg_policies where schemaname = 'public' and tablename in (select name from t) and cmd = 'SELECT') = 4
       and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in (select name from t) and cmd <> 'SELECT')
union all
select 'anon has no rights on the new tables; authenticated may only SELECT',
       not exists (select 1 from t where has_table_privilege('anon', 'public.' || name, 'select,insert,update,delete,truncate'))
       and (select bool_and(has_table_privilege('authenticated', 'public.' || name, 'select')
                            and not has_table_privilege('authenticated', 'public.' || name, 'insert,update,delete,truncate')) from t)
union all
select 'stock counts and 0031 snapshots are append-only (update/delete/truncate triggers)',
       (select count(*) from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
         where c.relname in ('inv_stock_counts', 'inv_month_snapshots2', 'inv_closed_months2') and not tg.tgisinternal) = 6
union all
select 'counting starts on the 1st of a month',
       (select counts_from = date_trunc('month', counts_from)::date from public.inv_count_settings where id)
union all
select 'no stock count and no 0031 snapshot yet (nothing was backfilled)',
       not exists (select 1 from public.inv_stock_counts) and not exists (select 1 from public.inv_month_snapshots2)
       and not exists (select 1 from public.inv_closed_months2)
union all
select 'the over-issue trigger is on inv_transactions',
       exists (select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
                where c.relname = 'inv_transactions' and tg.tgname = 'inv_transactions_no_negative' and tg.tgenabled = 'O')
union all
select 'anon may call no inv_ function',
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname like 'inv\_%' and has_function_privilege('anon', p.oid, 'execute'))
union all
select 'internal helpers are not callable by signed-in accounts',
       not has_function_privilege('authenticated', 'public.inv_balance_now(uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.inv_is_pending(uuid, date)', 'execute')
       and not has_function_privilege('authenticated', 'public.inv_put_count(uuid, numeric, text, text, text)', 'execute')
union all
select 'new write functions are security definer and check the role',
       (select bool_and(p.prosecdef and p.prosrc like '%inv_can_manage()%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('inv_record_stock_count', 'inv_record_entry2', 'inv_reverse_entry2'))
union all
select 'new reads are security invoker (RLS applies)',
       (select bool_and(not p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('inv_page3', 'inv_range_report2', 'inv_product_history3', 'inv_live_figures', 'inv_viewable_months'))
union all
select 'the earlier functions are all still there',
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('inv_rollover', 'inv_record_transaction', 'inv_record_entry', 'inv_reverse_entry',
               'inv_reverse_transaction', 'inv_page', 'inv_page2', 'inv_overview', 'inv_range_report', 'inv_product_history',
               'inv_product_history2', 'inv_import_products')) = 12;
