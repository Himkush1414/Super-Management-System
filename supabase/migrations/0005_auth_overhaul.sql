-- ============================================================================
-- NR Industries — 0005_auth_overhaul.sql
-- New signup flow (identity + OTP first, role assigned only at approval by
-- Head Admin), 7-day inactivity tracking, and Head Admin invisibility:
-- other roles must never see the head_admin row, its role string, or its
-- audit-log footprint. Functions are replaced via CREATE OR REPLACE (or
-- DROP + CREATE when the signature changes) — 0001-0004 are never hand-edited.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles: inactivity tracking
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists last_active_at timestamptz not null default now();

-- Defensive: there is exactly one Head Admin, ever (seeded, never self-signed-up).
create unique index if not exists one_head_admin_idx
  on public.profiles ((role = 'head_admin')) where (role = 'head_admin');

-- ---------------------------------------------------------------------------
-- signup_requests: role is chosen by Head Admin at approval time, not
-- requested by the user at sign-up.
-- ---------------------------------------------------------------------------
alter table public.signup_requests
  alter column requested_role drop not null,
  alter column requested_role drop default;
comment on column public.signup_requests.requested_role is
  'Set by Head Admin at approval time (review_signup_request). Null while pending — users no longer request a role at sign-up.';

-- ---------------------------------------------------------------------------
-- phone_otp_codes — dev-stub OTP for phone sign-up (spec: no real SMS
-- integration; verify against a dev-visible/logged code). No RLS policies
-- are granted to `authenticated` — only SECURITY DEFINER RPCs below and the
-- server's service-role client touch this table.
-- ---------------------------------------------------------------------------
create table if not exists public.phone_otp_codes (
  phone      text primary key,
  code_hash  text not null,
  expires_at timestamptz not null,
  verified   boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.phone_otp_codes enable row level security;

-- ---------------------------------------------------------------------------
-- handle_new_user: no requested_role from the client anymore. Every new
-- profile starts as role='maker' (inert placeholder — never shown or used
-- before approval) and status='pending'. Phone-created users (via the
-- admin.createUser path) carry phone on auth.users directly rather than in
-- metadata.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  is_demo boolean;
  cmethod text;
begin
  is_demo := coalesce((new.raw_user_meta_data ->> 'is_demo_account')::boolean, false);
  cmethod := coalesce(new.raw_user_meta_data ->> 'contact_method',
                       case when new.phone is not null then 'phone' else 'email' end);

  insert into public.profiles (id, full_name, email, phone, contact_method, role, status, is_demo_account)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    coalesce(new.phone, new.raw_user_meta_data ->> 'phone'),
    cmethod,
    'maker',
    case when is_demo then 'active'::user_status else 'pending'::user_status end,
    is_demo
  )
  on conflict (id) do nothing;

  if not is_demo then
    insert into public.signup_requests (profile_id, requested_role, status)
    values (new.id, null, 'pending');
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- audit_log: denormalised actor_role, so viewers who must never learn a Head
-- Admin exists can be shown a masked row instead of the real actor.
-- ---------------------------------------------------------------------------
alter table public.audit_log add column if not exists actor_role user_role;

create or replace view public.audit_log_view
  with (security_invoker = true) as
select
  id,
  entity_type,
  entity_id,
  action,
  before,
  after,
  created_at,
  case when actor_role = 'head_admin' and public.auth_role() <> 'head_admin'
       then null else actor_id end as actor_id,
  case when actor_role = 'head_admin' and public.auth_role() <> 'head_admin'
       then null else actor_label end as actor_label
from public.audit_log;
-- security_invoker keeps the base table's RLS (audit_select: has_perm('audit.view'))
-- enforced for whoever queries the view — only the actor fields are masked here.

grant select on public.audit_log_view to authenticated;

-- ---------------------------------------------------------------------------
-- review_signup_request: signature changes (adds `role`), so DROP + CREATE.
-- Head Admin only from here on — Admin's approval capability is reduced to
-- view-only (spec §2). Approval and role assignment happen as one action.
-- ---------------------------------------------------------------------------
drop function if exists public.review_signup_request(uuid, request_status, text);

create or replace function public.review_signup_request(
  request_id     uuid,
  decision       request_status,
  assigned_role  user_role default null,
  note           text default null
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
  if actor.id is null or actor.status <> 'active' or actor.role <> 'head_admin' then
    raise exception 'only the Head Admin can decide signup requests';
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
  if decision = 'approved' and (assigned_role is null or assigned_role = 'head_admin') then
    raise exception 'a valid, assignable role is required to approve';
  end if;

  new_stat := case when decision = 'approved' then 'active' else 'rejected' end;

  update public.signup_requests
     set status = decision,
         requested_role = case when decision = 'approved' then assigned_role else signup_requests.requested_role end,
         reviewer_id = actor.id, reviewed_at = now(), decision_note = note
   where id = request_id;

  update public.profiles
     set status = new_stat,
         role = case when decision = 'approved' then assigned_role else profiles.role end
   where id = req.profile_id;

  -- actor_label / actor_id are captured normally here — masking happens for
  -- *readers* via audit_log_view, not at write time, so Head Admin's own
  -- audit trail stays complete internally.
  insert into public.audit_log (actor_id, actor_role, actor_label, action, entity_type, entity_id, before, after)
  values (
    actor.id, actor.role,
    actor.full_name || ' (' || actor.role || ')',
    'signup.' || decision,
    'profile',
    req.profile_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', new_stat, 'role', assigned_role, 'note', note)
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

-- ---------------------------------------------------------------------------
-- set_user_role: head_admin can never be assigned to anyone (only ever
-- seeded), and the audit row now carries actor_role too.
-- ---------------------------------------------------------------------------
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
  if new_role = 'head_admin' then
    raise exception 'head_admin cannot be assigned — it is seeded once, never granted';
  end if;

  select * into old from public.profiles where id = target;
  if old.id is null then raise exception 'user not found'; end if;
  if old.id = actor.id then raise exception 'cannot change your own role'; end if;

  update public.profiles set role = new_role where id = target;

  insert into public.audit_log (actor_id, actor_role, actor_label, action, entity_type, entity_id, before, after)
  values (actor.id, actor.role, actor.full_name || ' (head_admin)', 'role.change', 'profile', target,
          jsonb_build_object('role', old.role), jsonb_build_object('role', new_role));

  insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
  values (target, 'account', 'Your role changed',
          'Your role is now ' || new_role || '.', 'profile', target);
end;
$$;

-- ---------------------------------------------------------------------------
-- guard_project_pricing / on_project_status_change: same logic as 0004, only
-- now also stamping actor_role for audit_log_view masking.
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
    insert into public.audit_log (actor_id, actor_role, actor_label, action, entity_type, entity_id, before, after)
    values (
      auth.uid(), actor.role,
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

create or replace function public.on_project_status_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_log (actor_id, actor_role, action, entity_type, entity_id, before, after)
    values (auth.uid(), public.auth_role(), 'project.status', 'project', new.id,
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

-- ---------------------------------------------------------------------------
-- has_perm: approvals.manage -> approvals.view (admin+head_admin) / decide
-- (head_admin only). Everything else unchanged.
-- ---------------------------------------------------------------------------
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
    when 'approvals.view'     then r in ('head_admin', 'admin')
    when 'approvals.decide'   then r = 'head_admin'
    when 'users.changeRole'   then r = 'head_admin'
    when 'permissions.edit'   then r = 'head_admin'
    when 'audit.view'         then r in ('head_admin', 'admin')
    when 'chat.access'        then r in ('head_admin', 'admin', 'manager', 'product_supervisor', 'maker')
    else false
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Head Admin invisibility, enforced at the RLS layer (not just UI hiding):
-- Admin (and teammates/staffing) never get the head_admin row back at all.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select using (
    public.is_admin_tier() and (role <> 'head_admin' or id = auth.uid())
  );

drop policy if exists profiles_select_teammates on public.profiles;
create policy profiles_select_teammates on public.profiles
  for select using (
    public.is_active() and role <> 'head_admin' and exists (
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
