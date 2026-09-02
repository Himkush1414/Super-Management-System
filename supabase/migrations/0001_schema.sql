-- ============================================================================
-- NR Industries — 0001_schema.sql
-- Core tables. RLS is ENABLED here on every table and POLICIES are added in
-- 0003_rls.sql. No table is ever reachable without RLS, even mid-migration.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type user_role as enum
    ('head_admin', 'admin', 'manager', 'product_supervisor', 'maker');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_status as enum
    ('pending', 'active', 'rejected', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type request_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type project_status as enum
    ('draft', 'quoted', 'approved', 'in_production',
     'quality_check', 'completed', 'on_hold', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_status as enum ('assigned', 'in_progress', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type transformer_type as enum
    ('distribution', 'power', 'dry_type', 'furnace', 'rectifier', 'isolation');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- profiles  (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  full_name        text not null default '',
  email            text,
  phone            text,
  contact_method   text not null default 'email' check (contact_method in ('email', 'phone')),
  role             user_role not null default 'maker',
  status           user_status not null default 'pending',
  is_demo_account  boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- signup_requests  (approval queue + re-apply history)
-- ---------------------------------------------------------------------------
create table if not exists public.signup_requests (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  requested_role user_role not null,
  status         request_status not null default 'pending',
  reviewer_id    uuid references public.profiles(id),
  reviewed_at    timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now()
);
create index if not exists signup_requests_status_idx on public.signup_requests(status);
create index if not exists signup_requests_profile_idx on public.signup_requests(profile_id);
alter table public.signup_requests enable row level security;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  client_name        text not null default '',
  client_contact     text,
  status             project_status not null default 'draft',

  -- structured transformer specs (never one text blob)
  transformer_kind   transformer_type not null default 'distribution',
  capacity_kva       numeric(12,2),
  primary_voltage    text,
  secondary_voltage  text,
  phase              smallint check (phase in (1, 3)),
  frequency_hz       smallint default 50,
  cooling_type       text,               -- e.g. ONAN, ONAF, AN
  impedance_pct      numeric(5,2),

  requirements_notes text not null default '',

  -- pricing / cost (RESTRICTED — see permission matrix)
  quantity           integer not null default 1 check (quantity > 0),
  unit_price         numeric(14,2),
  material_cost      numeric(14,2),
  labour_cost        numeric(14,2),
  margin             numeric(14,2),

  assigned_manager   uuid references public.profiles(id),
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists projects_manager_idx on public.projects(assigned_manager);
create index if not exists projects_status_idx on public.projects(status);
alter table public.projects enable row level security;

-- computed total is a plain generated column (still price data, still restricted)
alter table public.projects
  add column if not exists total_price numeric(16,2)
  generated always as (coalesce(unit_price, 0) * quantity) stored;

-- ---------------------------------------------------------------------------
-- project_assignments  (supervisors + makers scoped to a project)
-- ---------------------------------------------------------------------------
create table if not exists public.project_assignments (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  user_id            uuid not null references public.profiles(id) on delete cascade,
  role_at_assignment user_role not null,
  assigned_by        uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  unique (project_id, user_id)
);
create index if not exists assignments_user_idx on public.project_assignments(user_id);
create index if not exists assignments_project_idx on public.project_assignments(project_id);
alter table public.project_assignments enable row level security;

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  title       text not null,
  description text not null default '',
  assigned_to uuid references public.profiles(id),
  status      task_status not null default 'assigned',
  due_date    date,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tasks_assignee_idx on public.tasks(assigned_to);
create index if not exists tasks_project_idx on public.tasks(project_id);
alter table public.tasks enable row level security;

-- ---------------------------------------------------------------------------
-- messages  (per-project chat thread)
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  sender_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists messages_project_idx on public.messages(project_id, created_at);
alter table public.messages enable row level security;

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles(id),
  actor_label text,                          -- denormalised name+role snapshot
  action      text not null,                 -- e.g. 'price.update', 'role.change'
  entity_type text not null,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_created_idx on public.audit_log(created_at desc);
create index if not exists audit_entity_idx on public.audit_log(entity_type, entity_id);
alter table public.audit_log enable row level security;

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null,                 -- 'approval' | 'chat' | 'task' | 'status' | 'account'
  title       text not null,
  body        text not null default '',
  entity_type text,
  entity_id   uuid,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, read_at);
alter table public.notifications enable row level security;
