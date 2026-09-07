-- ============================================================================
-- NR Industries — 0008_orders_reset.sql
-- FULL REPLACEMENT of the previous auth/messaging/projects system.
--
-- Removes: self-signup + OTP + approvals, direct messaging + voice notes,
-- per-project chat, the transformer projects/tasks/specs domain, and the
-- formal audit log.
--
-- Rebuilds around: fixed accounts (no self-registration), 4 roles
-- (head_admin, admin, marketing, production), and a marketing -> production
-- order pipeline with a 5-stage tracker and WhatsApp placeholders.
--
-- head_admin invisibility (original spec §2) is preserved: the role exists in
-- the enum but no view / RLS policy / label ever surfaces it to another role.
-- ============================================================================

begin;

-- ── 1. tear down removed features ───────────────────────────────────────────
-- (triggers on dropped tables go with the table via CASCADE below)
drop trigger if exists on_auth_user_created on auth.users;

drop function if exists public.handle_new_user() cascade;
drop function if exists public.on_new_direct_message() cascade;
drop function if exists public.on_new_message() cascade;
drop function if exists public.on_new_signup_request() cascade;
drop function if exists public.on_project_status_change() cascade;
drop function if exists public.on_task_assigned() cascade;
drop function if exists public.guard_project_pricing() cascade;
drop function if exists public.guard_task_update() cascade;
drop function if exists public.review_signup_request(uuid, request_status, user_role, text) cascade;
drop function if exists public.review_signup_request(uuid, request_status, text) cascade;
drop function if exists public.reapply_signup(user_role) cascade;
drop function if exists public.set_user_role(uuid, user_role) cascade;
drop function if exists public.can_see_project(uuid) cascade;
drop function if exists public.can_edit_project_specs(uuid) cascade;
drop function if exists public.can_edit_project_pricing(uuid) cascade;
drop function if exists public.has_perm(text) cascade;
drop function if exists public.auth_role() cascade;
drop function if exists public.auth_status() cascade;
drop function if exists public.is_active() cascade;
drop function if exists public.is_admin_tier() cascade;

drop view if exists public.audit_log_view cascade;

drop table if exists public.direct_messages cascade;
drop table if exists public.direct_conversations cascade;
drop table if exists public.messages cascade;
drop table if exists public.tasks cascade;
drop table if exists public.project_assignments cascade;
drop table if exists public.projects cascade;
drop table if exists public.signup_requests cascade;
drop table if exists public.phone_otp_codes cascade;
drop table if exists public.audit_log cascade;

-- voice-notes storage (0006): policies only — the bucket itself must be
-- removed through the Storage API, not SQL. On a fresh reset it never exists.
drop policy if exists voice_notes_select on storage.objects;
drop policy if exists voice_notes_insert on storage.objects;

-- direct-message cleanup cron (0007), if pg_cron is present
do $$ begin
  perform cron.unschedule('cleanup-direct-messages');
exception when others then null; end $$;

-- ── 2. reshape profiles ────────────────────────────────────────────────────
drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select_admin on public.profiles;
drop policy if exists profiles_select_teammates on public.profiles;
drop policy if exists profiles_select_staffing on public.profiles;
drop policy if exists profiles_select_messaging on public.profiles;
drop policy if exists profiles_update_self on public.profiles;

alter table public.profiles
  drop column if exists is_demo_account,
  drop column if exists contact_method,
  drop column if exists last_active_at,
  drop column if exists status,
  drop column if exists email,
  drop column if exists phone,
  drop column if exists role;

drop type if exists user_status cascade;
drop type if exists request_status cascade;
drop type if exists project_status cascade;
drop type if exists task_status cascade;
drop type if exists transformer_type cascade;
drop type if exists user_role cascade;

create type user_role as enum ('head_admin', 'admin', 'marketing', 'production');

alter table public.profiles
  add column username text unique,
  add column role user_role not null default 'marketing';

-- ── 3. auth helpers used by RLS ────────────────────────────────────────────
-- Reads profiles without tripping its own policies (security definer).
create or replace function public.current_role_name()
returns user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin_tier()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_role_name() in ('head_admin', 'admin')
$$;

-- ── 4. new-user trigger: profile mirrors auth metadata ─────────────────────
-- No self-signup path reaches this; it exists so the seed (and any future
-- admin-created account) gets a profile row automatically.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'marketing')
  )
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 5. production settings — phone registration (spec §5) ──────────────────
create table public.production_settings (
  profile_id   uuid primary key references public.profiles(id) on delete cascade,
  phone        text,
  confirmed_at timestamptz,
  updated_at   timestamptz not null default now()
);
alter table public.production_settings enable row level security;
create trigger touch_production_settings before update on public.production_settings
  for each row execute function public.touch_updated_at();

-- ── 6. orders (spec §4, §6, §7) ───────────────────────────────────────────
create table public.orders (
  id                     uuid primary key default gen_random_uuid(),
  created_by             uuid not null references public.profiles(id),  -- a marketing account
  assigned_to            uuid not null references public.profiles(id),  -- a production account
  product_name           text not null,
  quality                text not null default '',
  quantity               integer not null default 1 check (quantity > 0),
  power_type             text not null default '',
  description            text not null default '',
  price                  numeric(14,2),                                -- RESTRICTED: never exposed to production
  stage                  smallint not null default 1 check (stage between 1 and 5),
  status                 text not null default 'active'
                           check (status in ('active', 'waiting_on_production_phone')),
  -- WhatsApp placeholders — NO real integration yet (spec §7)
  whatsapp_group_created boolean not null default false,
  whatsapp_group_id      text,
  production_phone       text,        -- snapshot of the assignee's confirmed phone at activation
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index orders_created_by_idx  on public.orders(created_by);
create index orders_assigned_to_idx on public.orders(assigned_to);
create index orders_status_idx      on public.orders(status);
alter table public.orders enable row level security;
create trigger touch_orders before update on public.orders
  for each row execute function public.touch_updated_at();

create table public.order_stage_events (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  from_stage smallint,
  to_stage   smallint not null check (to_stage between 1 and 5),
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index order_stage_events_order_idx on public.order_stage_events(order_id, created_at);
alter table public.order_stage_events enable row level security;

-- ── 7. price-safe read view (spec §3: production never sees price) ─────────
-- security_invoker keeps the base-table RLS below in force per querying user;
-- this only nulls the price column for anyone who isn't admin-tier or the
-- marketing account that created the order.
create view public.order_feed with (security_invoker = true) as
select
  o.id, o.created_by, o.assigned_to,
  o.product_name, o.quality, o.quantity, o.power_type, o.description,
  o.stage, o.status,
  case when public.is_admin_tier() or o.created_by = auth.uid()
       then o.price else null end as price,
  o.whatsapp_group_created, o.whatsapp_group_id, o.production_phone,
  o.created_at, o.updated_at
from public.orders o;

-- ── 8. RLS ────────────────────────────────────────────────────────────────
-- profiles: own row always; admin-tier sees every row EXCEPT head_admin,
-- which only head_admin can see (spec §2 invisibility).
create policy profiles_self on public.profiles
  for select using (id = auth.uid());
create policy profiles_admin_visible on public.profiles
  for select using (
    public.is_admin_tier()
    and (role <> 'head_admin' or public.current_role_name() = 'head_admin')
  );
-- marketing needs the production roster to choose a recipient on the
-- dispatch form (spec §4/§5). It sees production accounts only — never other
-- marketing accounts, never admin, never head_admin.
create policy profiles_marketing_sees_production on public.profiles
  for select using (
    public.current_role_name() = 'marketing' and role = 'production'
  );

create policy profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = public.current_role_name());

-- production_settings: production manages its own; admin-tier reads all.
create policy prodset_own on public.production_settings
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy prodset_admin_read on public.production_settings
  for select using (public.is_admin_tier());

-- orders row visibility
create policy orders_marketing_own on public.orders
  for select using (created_by = auth.uid());
create policy orders_production_assigned on public.orders
  for select using (assigned_to = auth.uid());
create policy orders_admin_all on public.orders
  for select using (public.is_admin_tier());

-- only a marketing account can dispatch, and only as itself
create policy orders_marketing_insert on public.orders
  for insert with check (
    created_by = auth.uid() and public.current_role_name() = 'marketing'
  );

-- only the assigned production account can update an order (stage advance)
create policy orders_production_update on public.orders
  for update
  using (assigned_to = auth.uid() and public.current_role_name() = 'production')
  with check (assigned_to = auth.uid());

-- admin-tier may update an order (used to auto-activate a waiting order once
-- the production phone lands — done server-side with the service role, but
-- this keeps a direct admin correction possible too)
create policy orders_admin_update on public.orders
  for update using (public.is_admin_tier()) with check (public.is_admin_tier());

-- stage history: readable by anyone who can see the parent order;
-- writable only by the assigned production account.
create policy ose_select on public.order_stage_events
  for select using (exists (select 1 from public.orders o where o.id = order_id));
create policy ose_insert on public.order_stage_events
  for insert with check (
    exists (select 1 from public.orders o
            where o.id = order_id and o.assigned_to = auth.uid())
  );

-- ── 9. notifications: keep table, refresh policies + purpose ───────────────
drop policy if exists notifications_select on public.notifications;
drop policy if exists notifications_update on public.notifications;
create policy notifications_select on public.notifications
  for select using (user_id = auth.uid());
create policy notifications_update on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
comment on column public.notifications.type is 'order | stage';

commit;
