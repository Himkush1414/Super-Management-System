-- ============================================================================
-- NR Industries — 0003_rls.sql
-- Row Level Security policies. Mirrors lib/permissions.ts and 0002 helpers.
-- A denied query is the access control — not a hidden button.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select using (id = auth.uid());

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select using (public.is_admin_tier());

-- Managers / supervisors / makers can see the profiles of people they share a
-- project with (needed to render assignee names + chat badges).
drop policy if exists profiles_select_teammates on public.profiles;
create policy profiles_select_teammates on public.profiles
  for select using (
    public.is_active() and exists (
      select 1
      from public.project_assignments mine
      join public.project_assignments theirs
        on theirs.project_id = mine.project_id
      where mine.user_id = auth.uid() and theirs.user_id = public.profiles.id
      union
      select 1 from public.projects p
      where p.assigned_manager = public.profiles.id
        and public.can_see_project(p.id)
    )
  );

-- Task-assigners (manager / admin tier) may browse active makers + supervisors
-- so they can staff a project.
drop policy if exists profiles_select_staffing on public.profiles;
create policy profiles_select_staffing on public.profiles
  for select using (
    public.has_perm('tasks.assign')
    and status = 'active'
    and role in ('maker', 'product_supervisor', 'manager')
  );

-- Users may edit their own name / phone only. role + status are NEVER writable
-- via this policy — they change only through the SECURITY DEFINER functions.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select role from public.profiles where id = auth.uid())
    and status = (select status from public.profiles where id = auth.uid())
  );

-- No direct INSERT (handled by handle_new_user trigger) and no direct DELETE.

-- ---------------------------------------------------------------------------
-- signup_requests
-- ---------------------------------------------------------------------------
drop policy if exists signup_select_own on public.signup_requests;
create policy signup_select_own on public.signup_requests
  for select using (profile_id = auth.uid());

drop policy if exists signup_select_reviewers on public.signup_requests;
create policy signup_select_reviewers on public.signup_requests
  for select using (public.is_admin_tier());
-- Writes go only through review_signup_request() / reapply_signup().

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select using (public.can_see_project(id));

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert with check (
    public.has_perm('projects.create') and created_by = auth.uid()
  );

-- Update is allowed for spec-editors OR pricing-editors in scope. Column-level
-- protection of price fields is enforced by the guard_pricing trigger (0004).
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update using (
    public.can_edit_project_specs(id) or public.can_edit_project_pricing(id)
  )
  with check (
    public.can_edit_project_specs(id) or public.can_edit_project_pricing(id)
  );

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete using (public.auth_role() in ('head_admin', 'admin'));

-- ---------------------------------------------------------------------------
-- project_assignments
-- ---------------------------------------------------------------------------
drop policy if exists assignments_select on public.project_assignments;
create policy assignments_select on public.project_assignments
  for select using (
    user_id = auth.uid() or public.can_see_project(project_id)
  );

drop policy if exists assignments_write on public.project_assignments;
create policy assignments_write on public.project_assignments
  for insert with check (
    public.has_perm('tasks.assign') and public.can_see_project(project_id)
  );

drop policy if exists assignments_delete on public.project_assignments;
create policy assignments_delete on public.project_assignments
  for delete using (
    public.has_perm('tasks.assign') and public.can_see_project(project_id)
  );

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
-- Makers see ONLY their own tasks. Everyone else sees tasks on projects in scope.
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select using (
    assigned_to = auth.uid()
    or (public.auth_role() <> 'maker' and public.can_see_project(project_id))
  );

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert with check (
    public.has_perm('tasks.assign') and public.can_see_project(project_id)
  );

-- Assignees may update their OWN task (status ladder enforced in 0004).
-- Task managers may update any task on a project in scope.
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update using (
    assigned_to = auth.uid()
    or (public.has_perm('tasks.assign') and public.can_see_project(project_id))
  )
  with check (
    assigned_to = auth.uid()
    or (public.has_perm('tasks.assign') and public.can_see_project(project_id))
  );

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete using (
    public.has_perm('tasks.assign') and public.can_see_project(project_id)
  );

-- ---------------------------------------------------------------------------
-- messages  (per-project chat)
-- ---------------------------------------------------------------------------
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (
    public.has_perm('chat.access') and public.can_see_project(project_id)
  );

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert with check (
    sender_id = auth.uid()
    and public.has_perm('chat.access')
    and public.can_see_project(project_id)
  );

-- Senders may delete their own message; admin tier may moderate any.
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete using (sender_id = auth.uid() or public.is_admin_tier());

-- ---------------------------------------------------------------------------
-- audit_log  (Admin + Head Admin read only; writes are definer-only)
-- ---------------------------------------------------------------------------
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log
  for select using (public.has_perm('audit.view'));

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());
