-- ============================================================================
-- NR Industries — 0004_triggers.sql
-- Column-level guards, the Maker status ladder, audit capture, notification
-- fan-out, and realtime publication.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Pricing column guard.
-- RLS lets spec-editors UPDATE a project row; this stops them from touching
-- price columns unless they also have pricing.edit in scope. Also captures a
-- price-change audit entry with before/after.
-- ---------------------------------------------------------------------------
create or replace function public.guard_project_pricing()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  price_changed boolean;
  actor public.profiles%rowtype;
begin
  price_changed :=
       new.unit_price     is distinct from old.unit_price
    or new.material_cost  is distinct from old.material_cost
    or new.labour_cost    is distinct from old.labour_cost
    or new.margin         is distinct from old.margin
    or new.quantity       is distinct from old.quantity;

  if price_changed then
    if not public.can_edit_project_pricing(new.id) then
      raise exception 'pricing fields are restricted for your role';
    end if;

    select * into actor from public.profiles where id = auth.uid();
    insert into public.audit_log (actor_id, actor_label, action, entity_type, entity_id, before, after)
    values (
      auth.uid(),
      coalesce(actor.full_name, '?') || ' (' || coalesce(actor.role::text, '?') || ')',
      'price.update', 'project', new.id,
      jsonb_build_object(
        'unit_price', old.unit_price, 'material_cost', old.material_cost,
        'labour_cost', old.labour_cost, 'margin', old.margin, 'quantity', old.quantity),
      jsonb_build_object(
        'unit_price', new.unit_price, 'material_cost', new.material_cost,
        'labour_cost', new.labour_cost, 'margin', new.margin, 'quantity', new.quantity)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists guard_pricing on public.projects;
create trigger guard_pricing before update on public.projects
  for each row execute function public.guard_project_pricing();

-- ---------------------------------------------------------------------------
-- Project status-change -> notify manager + assigned team + audit.
-- ---------------------------------------------------------------------------
create or replace function public.on_project_status_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
    values (auth.uid(), 'project.status', 'project', new.id,
            jsonb_build_object('status', old.status),
            jsonb_build_object('status', new.status));

    insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
    select distinct uid, 'status',
           'Project status: ' || new.name,
           'Now "' || new.status || '" (was "' || old.status || '").',
           'project', new.id
    from (
      select new.assigned_manager as uid
      union
      select user_id from public.project_assignments where project_id = new.id
    ) t
    where uid is not null and uid <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000');
  end if;
  return new;
end;
$$;

drop trigger if exists project_status_change on public.projects;
create trigger project_status_change after update on public.projects
  for each row execute function public.on_project_status_change();

-- ---------------------------------------------------------------------------
-- Maker status ladder: assigned -> in_progress -> completed (and one step
-- back). No skips, no other columns editable by the assignee.
-- ---------------------------------------------------------------------------
create or replace function public.guard_task_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare valid boolean;
begin
  -- Task managers (assign perm) may do anything the policy already allowed.
  if public.has_perm('tasks.assign') and public.can_see_project(new.project_id) then
    return new;
  end if;

  -- Otherwise this must be the assignee touching only status.
  if old.assigned_to is distinct from auth.uid() then
    raise exception 'you can only update your own task';
  end if;

  if new.title <> old.title
     or new.description <> old.description
     or new.assigned_to is distinct from old.assigned_to
     or new.project_id <> old.project_id
     or new.due_date is distinct from old.due_date then
    raise exception 'you may only change task status';
  end if;

  valid := (old.status, new.status) in (
    ('assigned', 'in_progress'),
    ('in_progress', 'completed'),
    ('in_progress', 'assigned'),
    ('completed', 'in_progress')
  ) or new.status = old.status;

  if not valid then
    raise exception 'invalid status transition % -> %', old.status, new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_task on public.tasks;
create trigger guard_task before update on public.tasks
  for each row execute function public.guard_task_update();

-- ---------------------------------------------------------------------------
-- Task assignment -> notify the Maker.
-- ---------------------------------------------------------------------------
create or replace function public.on_task_assigned()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' or (new.assigned_to is distinct from old.assigned_to) then
    if new.assigned_to is not null then
      insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
      values (new.assigned_to, 'task', 'New task assigned',
              new.title, 'task', new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists task_assigned on public.tasks;
create trigger task_assigned after insert or update on public.tasks
  for each row execute function public.on_task_assigned();

-- ---------------------------------------------------------------------------
-- New chat message -> notify everyone in project scope except the sender.
-- ---------------------------------------------------------------------------
create or replace function public.on_new_message()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
  select distinct uid, 'chat',
         'New message',
         left(new.body, 120),
         'project', new.project_id
  from (
    select assigned_manager as uid from public.projects where id = new.project_id
    union
    select user_id from public.project_assignments where project_id = new.project_id
  ) t
  where uid is not null and uid <> new.sender_id;
  return new;
end;
$$;

drop trigger if exists new_message on public.messages;
create trigger new_message after insert on public.messages
  for each row execute function public.on_new_message();

-- ---------------------------------------------------------------------------
-- New signup request -> notify all Admin + Head Admin (live approvals queue).
-- ---------------------------------------------------------------------------
create or replace function public.on_new_signup_request()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'pending' then
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
    select p.id, 'approval', 'New access request',
           'A user requested the ' || new.requested_role || ' role.',
           'signup_request', new.id
    from public.profiles p
    where p.role in ('head_admin', 'admin') and p.status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists new_signup_request on public.signup_requests;
create trigger new_signup_request after insert on public.signup_requests
  for each row execute function public.on_new_signup_request();

-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'alter publication supabase_realtime add table public.projects';
  execute 'alter publication supabase_realtime add table public.tasks';
  execute 'alter publication supabase_realtime add table public.messages';
  execute 'alter publication supabase_realtime add table public.notifications';
  execute 'alter publication supabase_realtime add table public.signup_requests';
exception when duplicate_object then null;
end $$;
