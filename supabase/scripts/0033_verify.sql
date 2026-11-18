-- ============================================================================
-- NR Industries — supabase/scripts/0033_verify.sql   (NOT a migration)
-- READ-ONLY. Run after 0033: every row must say ok = true.
-- ============================================================================
select 'inv_import_runs exists with RLS on, one read policy, append-only' as check,
       exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relname = 'inv_import_runs' and c.relrowsecurity)
       and (select count(*) from pg_policies where tablename = 'inv_import_runs' and cmd = 'SELECT') = 1
       and not exists (select 1 from pg_policies where tablename = 'inv_import_runs' and cmd <> 'SELECT')
       and (select count(*) from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
             where c.relname = 'inv_import_runs' and not tg.tgisinternal) = 2 as ok
union all
select 'the run table stores counts only (no file name, no content)',
       (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
         where table_schema = 'public' and table_name = 'inv_import_runs')
       = array['id', 'batch_key', 'rows_in_file', 'counted', 'adjusted', 'added', 'filled', 'archived', 'created_by', 'created_at']
union all
select 'inv_stock_counts.import_run_id is a nullable column; no count has one yet',
       exists (select 1 from information_schema.columns where table_name = 'inv_stock_counts' and column_name = 'import_run_id' and is_nullable = 'YES')
       and not exists (select 1 from public.inv_stock_counts where import_run_id is not null)
union all
select 'no import has run yet',
       not exists (select 1 from public.inv_import_runs)
union all
select 'anon has no rights on runs; authenticated may only SELECT',
       not has_table_privilege('anon', 'public.inv_import_runs', 'select,insert,update,delete,truncate')
       and has_table_privilege('authenticated', 'public.inv_import_runs', 'select')
       and not has_table_privilege('authenticated', 'public.inv_import_runs', 'insert,update,delete,truncate')
union all
select 'the apply function is security definer and checks the role',
       (select p.prosecdef and p.prosrc like '%inv_can_manage()%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'inv_import_apply')
union all
select 'anon may call no inv_ function',
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname like 'inv\_%' and has_function_privilege('anon', p.oid, 'execute'));
