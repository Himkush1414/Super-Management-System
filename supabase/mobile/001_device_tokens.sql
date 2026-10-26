-- ============================================================================
-- NR Management (mobile app) — 001_device_tokens.sql
--
-- ADDITIVE ONLY. Creates one new table and two new functions. It does not
-- touch any existing table, row, column, policy, function, trigger, user or
-- publication. Safe to re-run (if not exists / create or replace).
--
-- Not a migration in supabase/migrations on purpose: it is applied by hand
-- in the SQL editor (see docs/mobile-push-setup.md), so `supabase db push`
-- can never run it by accident.
--
-- What it is for: each phone running the app registers its Expo push token
-- here for the signed-in user, so the notify-new-order Edge Function knows
-- where to send "new order" notifications.
-- ============================================================================

begin;

create table if not exists public.device_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null unique
                    check (char_length(expo_push_token) <= 200
                           and expo_push_token ~ '^Expo(nent)?PushToken\[[^]]{8,}\]$'),
  platform        text not null check (platform in ('android', 'ios')),
  app_version     text check (char_length(app_version) <= 40),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  -- set by the Edge Function when Expo reports DeviceNotRegistered
  invalidated_at  timestamptz
);
create index if not exists device_tokens_user_idx on public.device_tokens(user_id);

-- ── RLS: each user sees and manages only their own rows ──────────────────────
alter table public.device_tokens enable row level security;

drop policy if exists device_tokens_select_own on public.device_tokens;
create policy device_tokens_select_own on public.device_tokens
  for select to authenticated using (user_id = auth.uid());

drop policy if exists device_tokens_insert_own on public.device_tokens;
create policy device_tokens_insert_own on public.device_tokens
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists device_tokens_update_own on public.device_tokens;
create policy device_tokens_update_own on public.device_tokens
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists device_tokens_delete_own on public.device_tokens;
create policy device_tokens_delete_own on public.device_tokens
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.device_tokens from anon;
grant select, insert, update, delete on public.device_tokens to authenticated;

-- ── register: the app calls this with the user's own session ────────────────
-- A phone that changes hands (one account signs out, another signs in)
-- keeps one row: the token moves to the new user. That row belongs to
-- someone else until then, which RLS would (correctly) refuse to update,
-- so this one step runs as definer — strictly for auth.uid().
create or replace function public.register_device_token(
  p_token       text,
  p_platform    text,
  p_app_version text default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles
                  where id = auth.uid()
                    and role::text in ('head_admin', 'admin', 'marketing', 'production')) then
    raise exception 'this account is not in use' using errcode = '42501';
  end if;

  insert into public.device_tokens (user_id, expo_push_token, platform, app_version)
  values (auth.uid(), p_token, p_platform, left(p_app_version, 40))
  on conflict (expo_push_token) do update
     set user_id        = excluded.user_id,
         platform       = excluded.platform,
         app_version    = excluded.app_version,
         updated_at     = now(),
         last_seen_at   = now(),
         invalidated_at = null;
end $$;
revoke all on function public.register_device_token(text, text, text) from public, anon;
grant execute on function public.register_device_token(text, text, text) to authenticated;

-- ── unregister: the app calls this on sign-out ──────────────────────────────
-- After sign-out the session may already be gone, so this is callable with
-- the anon key. It removes only the row for the exact token given, which
-- only that phone knows (tokens are never readable by other users).
create or replace function public.unregister_device_token(p_token text)
returns void
language sql security definer set search_path = public as $$
  delete from public.device_tokens where expo_push_token = p_token;
$$;
revoke all on function public.unregister_device_token(text) from public;
grant execute on function public.unregister_device_token(text) to anon, authenticated;

commit;
