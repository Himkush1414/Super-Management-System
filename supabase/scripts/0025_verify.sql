-- ============================================================================
-- NR Industries — supabase/scripts/0025_verify.sql   (NOT a migration)
-- Read-only checks right after 0025. Every row must say ok (true).
-- Data safety: run 0024_snapshot.sql before and after; it must be identical.
-- ============================================================================
select check_name, ok from (values
  ('0025 recorded in schema_migrations',
     (select count(*) = 1 from supabase_migrations.schema_migrations where version = '0025')),
  ('guard functions exist with a fixed search_path',
     (select count(*) = 2 from pg_proc where oid in ('public.guard_bulk_delete()'::regprocedure, 'public.guard_truncate()'::regprocedure)
        and proconfig @> array['search_path=""'])),
  ('no API role may call the guard functions',
     not has_function_privilege('anon', 'public.guard_bulk_delete()', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.guard_bulk_delete()', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.guard_truncate()', 'EXECUTE')),
  ('the 7 tables each have both guards, enabled (14 triggers)',
     (select count(*) = 14 from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where t.tgenabled = 'O'
         and c.relname in ('orders', 'order_items', 'order_stage_events', 'order_assignees',
                           'profiles', 'production_settings', 'notifications')
         and t.tgname in (c.relname || '_guard_bulk_delete', c.relname || '_guard_truncate')))
) v(check_name, ok);
