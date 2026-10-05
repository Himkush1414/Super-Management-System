-- ============================================================================
-- NR Industries — 0018_overview_fixed_accounts.sql
--
-- The live project holds one leftover auth account from the retired
-- self-sign-up system (pre-0008): it has a profile with NO username (0008
-- re-created `role` with default 'marketing'). It can't sign in through the
-- PIN login (which is by username) and owns no data, but listing it on the
-- admin data page broke the username-based reset confirmation. The page
-- works on the fixed, named accounts only.
-- ============================================================================

begin;

create or replace function public.admin_account_overview()
returns table (
  profile_id uuid, username text, full_name text, real_name text, display_name text, role user_role,
  orders_dispatched int, orders_assigned int, stage_updates int, notifications int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin_tier() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  return query
  select p.id, p.username, p.full_name, p.real_name, public.display_name(p.id), p.role,
         (select count(*)::int from public.orders o where o.created_by = p.id),
         (select count(*)::int from public.order_assignees a where a.profile_id = p.id),
         (select count(*)::int from public.order_stage_events e where e.changed_by = p.id and e.from_stage is not null),
         (select count(*)::int from public.notifications n where n.user_id = p.id)
    from public.profiles p
   where p.role in ('marketing', 'production')
     and p.username is not null
   order by p.role, p.username;
end $$;
revoke all on function public.admin_account_overview() from public, anon;
grant execute on function public.admin_account_overview() to authenticated;

commit;
