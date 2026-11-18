-- ============================================================================
-- NR Industries — supabase/scripts/0032_verify.sql   (NOT a migration)
-- READ-ONLY. Run after 0032: every row must say ok = true.
-- ============================================================================
select 'inv_product_tombstones exists with RLS on, one read policy' as check,
       exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relname = 'inv_product_tombstones' and c.relrowsecurity)
       and (select count(*) from pg_policies where tablename = 'inv_product_tombstones' and cmd = 'SELECT') = 1
       and not exists (select 1 from pg_policies where tablename = 'inv_product_tombstones' and cmd <> 'SELECT') as ok
union all
select 'anon has no rights on tombstones; authenticated may only SELECT',
       not has_table_privilege('anon', 'public.inv_product_tombstones', 'select,insert,update,delete,truncate')
       and has_table_privilege('authenticated', 'public.inv_product_tombstones', 'select')
       and not has_table_privilege('authenticated', 'public.inv_product_tombstones', 'insert,update,delete,truncate')
union all
select 'tombstones are append-only',
       (select count(*) from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
         where c.relname = 'inv_product_tombstones' and not tg.tgisinternal) = 2
union all
select 'the product delete trigger uses the tombstone guard; truncate guards unchanged',
       exists (select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_proc p on p.oid = tg.tgfoid
                where c.relname = 'inv_products' and tg.tgname = 'inv_products_no_delete' and p.proname = 'inv_guard_product_delete')
       and exists (select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_proc p on p.oid = tg.tgfoid
                where c.relname = 'inv_product_log' and tg.tgname = 'inv_product_log_append_only' and p.proname = 'inv_guard_product_log_change')
       and (select count(*) from pg_trigger tg join pg_proc p on p.oid = tg.tgfoid
             where tg.tgname like 'inv\_%no\_truncate' and p.proname = 'inv_forbid_change') >= 7
union all
select 'no product was deleted by the migration (no tombstone yet)',
       not exists (select 1 from public.inv_product_tombstones)
union all
select 'restore / delete are security definer and check the role; the list is security invoker',
       (select bool_and(p.prosecdef and p.prosrc like '%inv_can_manage()%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('inv_restore_products', 'inv_delete_archived_product'))
       and (select not prosecdef from pg_proc where proname = 'inv_archive_list')
union all
select 'internal helpers are not callable by signed-in accounts',
       not has_function_privilege('authenticated', 'public.inv_has_history(uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.inv_tombstoned_now(uuid)', 'execute')
union all
select 'anon may call no inv_ function',
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname like 'inv\_%' and has_function_privilege('anon', p.oid, 'execute'));
