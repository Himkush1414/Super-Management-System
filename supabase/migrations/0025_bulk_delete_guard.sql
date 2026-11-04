-- ============================================================================
-- NR Industries — 0025_bulk_delete_guard.sql
--
-- A safety catch against losing data by mistake. Additive: it only adds two
-- functions and triggers; no table, column, row or existing function changes.
--
--   * One DELETE statement may remove at most ONE row from orders,
--     order_items, order_stage_events, order_assignees, profiles,
--     production_settings or notifications. The app only ever deletes one
--     order or one stage update at a time, so this never gets in its way.
--     A pasted `delete from orders;` (or a `?id=neq.x` request with an
--     admin session) is refused and nothing is removed.
--   * TRUNCATE of those tables is always refused.
--   * Still allowed, unchanged:
--       - the rows a single-order delete cascades to (its items, stage
--         history, assignees, notifications), recognised because their
--         parent row is already gone, and deletes made inside another
--         trigger (the order-delete audit clears that order's notifications);
--       - admin_reset_account(), the app's audited account reset, which
--         marks its transaction with nr.audit_batch (0013 / 0017);
--       - a deliberate bulk change by the owner, in one transaction, after a
--         backup (docs/DATA-SAFETY.md):
--           begin;
--           set local nr.allow_bulk_delete = 'on';
--           delete from ...;
--           commit;
--         `set local` ends with the transaction, so it can't be left on.
--   * API roles can't set either flag: PostgREST runs no SET from a request,
--     and set_config is not an exposed function.
--
-- Rollback (removes only what this file adds):
--   drop trigger ... on each table (names below), then
--   drop function public.guard_bulk_delete(), public.guard_truncate();
-- ============================================================================

begin;

-- SECURITY DEFINER so the parent checks below see every row (RLS would hide
-- rows from the deleting session and could make a parent look gone).
create or replace function public.guard_bulk_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int := coalesce(tg_argv[0], '1')::int;
  v_rows  bigint;
  v_part_of_parent boolean := false;
begin
  if pg_trigger_depth() > 1                                              -- inside another trigger (the order delete audit)
     or nullif(current_setting('nr.audit_batch', true), '') is not null  -- admin_reset_account()
     or current_setting('nr.allow_bulk_delete', true) = 'on' then        -- deliberate, after a backup
    return null;
  end if;
  select count(*) into v_rows from deleted_rows;
  if v_rows <= v_limit then
    return null;
  end if;

  -- A cascade (ON DELETE CASCADE) runs at the same trigger depth as a direct
  -- delete, so recognise it by its parent: every removed row's parent row is
  -- already gone, i.e. the rows went with the one order / account deleted.
  -- (Each branch is its own statement: plpgsql plans it only when it runs.)
  if tg_table_name in ('order_items', 'order_stage_events') then
    select not exists (select 1 from deleted_rows d join public.orders o on o.id = d.order_id)
      into v_part_of_parent;
  elsif tg_table_name = 'order_assignees' then
    select not exists (select 1 from deleted_rows d
                         join public.orders o   on o.id = d.order_id
                         join public.profiles p on p.id = d.profile_id)
      into v_part_of_parent;
  elsif tg_table_name = 'notifications' then
    select not exists (select 1 from deleted_rows d join public.profiles p on p.id = d.user_id)
      into v_part_of_parent;
  elsif tg_table_name = 'production_settings' then
    select not exists (select 1 from deleted_rows d join public.profiles p on p.id = d.profile_id)
      into v_part_of_parent;
  elsif tg_table_name = 'profiles' then
    select not exists (select 1 from deleted_rows d join auth.users u on u.id = d.id)
      into v_part_of_parent;
  end if;
  if v_part_of_parent then
    return null;
  end if;

  raise exception 'refusing to delete % rows from %.% in one statement (the limit is %); nothing was deleted',
    v_rows, tg_table_schema, tg_table_name, v_limit
    using errcode = 'P0001',
          hint = 'Delete one row at a time, or take a backup and use set local nr.allow_bulk_delete = ''on'' in the same transaction (docs/DATA-SAFETY.md).';
end $$;

create or replace function public.guard_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('nr.allow_bulk_delete', true) = 'on' then
    return null;
  end if;
  raise exception 'refusing to truncate %.%; nothing was deleted', tg_table_schema, tg_table_name
    using errcode = 'P0001',
          hint = 'Take a backup and use set local nr.allow_bulk_delete = ''on'' in the same transaction (docs/DATA-SAFETY.md).';
end $$;

revoke all on function public.guard_bulk_delete() from public, anon, authenticated;
revoke all on function public.guard_truncate()    from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['orders', 'order_items', 'order_stage_events', 'order_assignees',
                           'profiles', 'production_settings', 'notifications'] loop
    execute format(
      'create trigger %I after delete on public.%I referencing old table as deleted_rows
         for each statement execute function public.guard_bulk_delete(%L)',
      t || '_guard_bulk_delete', t, '1');
    execute format(
      'create trigger %I before truncate on public.%I
         for each statement execute function public.guard_truncate()',
      t || '_guard_truncate', t);
  end loop;
end $$;

commit;
