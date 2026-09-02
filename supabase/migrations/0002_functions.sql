-- ============================================================================
-- NR Industries — 0002_functions.sql
-- SECURITY DEFINER helpers used by RLS policies. They read profiles without
-- triggering the profiles policies (avoids infinite recursion) and encode the
-- SAME permission matrix as lib/permissions.ts.
-- ============================================================================

-- Current user's role, or null.
create or replace function public.auth_role()
returns user_role
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Current user's account status.
create or replace function public.auth_status()
returns user_status
language sql stable security definer set search_path = public
as $$
  select status from public.profiles where id = auth.uid();
$$;

create or replace function public.is_active()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select status = 'active' from public.profiles where id = auth.uid()),
    false);
$$;

-- head_admin or admin
create or replace function public.is_admin_tier()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_active() and public.auth_role() in ('head_admin', 'admin');
$$;

-- ----------------------------------------------------------------------------
-- has_perm(): the permission matrix, in SQL. Keep in lock-step with
-- lib/permissions.ts PERMISSION_MATRIX.
-- ----------------------------------------------------------------------------
create or replace function public.has_perm(perm text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare r user_role;
begin
  if not public.is_active() then
    return false;
  end if;
  r := public.auth_role();

  return case perm
    when 'projects.viewAll'   then r in ('head_admin', 'admin')
    when 'projects.create'    then r in ('head_admin', 'admin', 'manager')
    when 'pricing.view'       then r in ('head_admin', 'admin', 'manager')
    when 'pricing.edit'       then r in ('head_admin', 'admin', 'manager')
    when 'specs.view'         then r in ('head_admin', 'admin', 'manager', 'product_supervisor', 'maker')
    when 'specs.edit'         then r in ('head_admin', 'admin', 'manager', 'product_supervisor')
    when 'tasks.assign'       then r in ('head_admin', 'admin', 'manager')
    when 'approvals.manage'   then r in ('head_admin', 'admin')
    when 'users.changeRole'   then r = 'head_admin'
    when 'permissions.edit'   then r = 'head_admin'
    when 'audit.view'         then r in ('head_admin', 'admin')
    when 'chat.access'        then r in ('head_admin', 'admin', 'manager', 'product_supervisor', 'maker')
    else false
  end;
end;
$$;

-- ----------------------------------------------------------------------------
-- Project scope: can the current user see this project at all?
--   - admin tier or explicit viewAll  -> every project
--   - assigned manager                -> that project
--   - row in project_assignments      -> that project
-- ----------------------------------------------------------------------------
create or replace function public.can_see_project(pid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_active() and (
    public.has_perm('projects.viewAll')
    or exists (select 1 from public.projects p
               where p.id = pid and p.assigned_manager = auth.uid())
    or exists (select 1 from public.project_assignments a
               where a.project_id = pid and a.user_id = auth.uid())
  );
$$;

-- Can the current user EDIT this project's non-price fields (specs / status)?
create or replace function public.can_edit_project_specs(pid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_active() and public.has_perm('specs.edit') and (
    public.has_perm('projects.viewAll')
    or exists (select 1 from public.projects p
               where p.id = pid and p.assigned_manager = auth.uid())
    or exists (select 1 from public.project_assignments a
               where a.project_id = pid and a.user_id = auth.uid())
  );
$$;

-- Can the current user EDIT this project's pricing fields?
create or replace function public.can_edit_project_pricing(pid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_active() and public.has_perm('pricing.edit') and (
    public.has_perm('projects.viewAll')
    or exists (select 1 from public.projects p
               where p.id = pid and p.assigned_manager = auth.uid())
  );
$$;

-- ----------------------------------------------------------------------------
-- new auth user -> profile + signup request
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  req_role   user_role;
  is_demo    boolean;
  cmethod    text;
begin
  req_role := coalesce((new.raw_user_meta_data ->> 'requested_role')::user_role, 'maker');
  -- Admin tiers are never self-assignable at sign-up.
  if req_role in ('head_admin', 'admin') then
    req_role := 'maker';
  end if;

  is_demo := coalesce((new.raw_user_meta_data ->> 'is_demo_account')::boolean, false);
  cmethod := coalesce(new.raw_user_meta_data ->> 'contact_method', 'email');

  insert into public.profiles (id, full_name, email, phone, contact_method, role, status, is_demo_account)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    new.raw_user_meta_data ->> 'phone',
    cmethod,
    req_role,
    case when is_demo then 'active'::user_status else 'pending'::user_status end,
    is_demo
  )
  on conflict (id) do nothing;

  if not is_demo then
    insert into public.signup_requests (profile_id, requested_role, status)
    values (new.id, req_role, 'pending');
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- generic updated_at
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_profiles on public.profiles;
create trigger touch_profiles before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_projects on public.projects;
create trigger touch_projects before update on public.projects
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_tasks on public.tasks;
create trigger touch_tasks before update on public.tasks
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Approve / reject a signup request. Head Admin or Admin only.
-- Runs as definer so it can flip profile status + write audit + notify.
-- ----------------------------------------------------------------------------
create or replace function public.review_signup_request(
  request_id uuid,
  decision   request_status,
  note       text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  req      public.signup_requests%rowtype;
  actor    public.profiles%rowtype;
  new_stat user_status;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null or actor.status <> 'active'
     or actor.role not in ('head_admin', 'admin') then
    raise exception 'not authorised to review signup requests';
  end if;

  select * into req from public.signup_requests where id = request_id for update;
  if req.id is null then
    raise exception 'signup request not found';
  end if;
  if req.status <> 'pending' then
    raise exception 'signup request already %', req.status;
  end if;
  if decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected';
  end if;

  new_stat := case when decision = 'approved' then 'active' else 'rejected' end;

  update public.signup_requests
     set status = decision, reviewer_id = actor.id,
         reviewed_at = now(), decision_note = note
   where id = request_id;

  update public.profiles
     set status = new_stat,
         role = case when decision = 'approved' then req.requested_role else role end
   where id = req.profile_id;

  insert into public.audit_log (actor_id, actor_label, action, entity_type, entity_id, before, after)
  values (
    actor.id,
    actor.full_name || ' (' || actor.role || ')',
    'signup.' || decision,
    'profile',
    req.profile_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', new_stat, 'note', note)
  );

  insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
  values (
    req.profile_id,
    'account',
    case when decision = 'approved' then 'Access approved' else 'Access request denied' end,
    case when decision = 'approved'
         then 'Your NR Industries account is active. You can now sign in.'
         else coalesce(note, 'Your request was declined. Contact an administrator or re-apply.') end,
    'profile',
    req.profile_id
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- Re-apply after a rejection (spec §2.4 — never dead-end the user).
-- ----------------------------------------------------------------------------
create or replace function public.reapply_signup(requested user_role default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare me public.profiles%rowtype;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.status <> 'rejected' then
    raise exception 'only rejected accounts can re-apply';
  end if;

  if exists (select 1 from public.signup_requests
             where profile_id = me.id and status = 'pending') then
    raise exception 'a request is already pending';
  end if;

  update public.profiles set status = 'pending' where id = me.id;

  insert into public.signup_requests (profile_id, requested_role, status)
  values (me.id,
          case when requested in ('head_admin','admin') or requested is null
               then me.role else requested end,
          'pending');
end;
$$;

-- ----------------------------------------------------------------------------
-- Head Admin: change a user's role (only path that can touch profiles.role).
-- ----------------------------------------------------------------------------
create or replace function public.set_user_role(target uuid, new_role user_role)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  old   public.profiles%rowtype;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null or actor.status <> 'active' or actor.role <> 'head_admin' then
    raise exception 'only the Head Admin can change roles';
  end if;

  select * into old from public.profiles where id = target;
  if old.id is null then raise exception 'user not found'; end if;
  if old.id = actor.id then raise exception 'cannot change your own role'; end if;

  update public.profiles set role = new_role where id = target;

  insert into public.audit_log (actor_id, actor_label, action, entity_type, entity_id, before, after)
  values (actor.id, actor.full_name || ' (head_admin)', 'role.change', 'profile', target,
          jsonb_build_object('role', old.role), jsonb_build_object('role', new_role));

  insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
  values (target, 'account', 'Your role changed',
          'Your role is now ' || new_role || '.', 'profile', target);
end;
$$;
