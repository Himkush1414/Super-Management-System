-- ============================================================================
-- NR Industries — 0014_pin_login.sql
--
-- 6-digit numeric PIN login with server-side rate limiting / lockout, and the
-- closure of an open self-registration path.
--
-- WHY THE PIN IS NOT THE SUPABASE AUTH PASSWORD
--   A 6-digit PIN has only 1,000,000 values. If it were the GoTrue password,
--   anyone could brute-force it straight against
--   POST /auth/v1/token?grant_type=password with the public anon key — the
--   app's own rate limiting would never see those requests. So:
--     * the PIN lives here, bcrypt-hashed in account_pins (no API role can
--       read it), and is checked only by pin_login_attempt(), which applies
--       per-account and per-IP lockout atomically in the same transaction;
--     * each account's actual GoTrue password is set to 64 random hex chars
--       that nobody knows (set_account_pin), so the password grant is useless;
--     * after a successful PIN check the server mints the session itself
--       (admin generateLink -> verifyOtp, a single-use token).
--
-- LOCKOUT
--   5 failed PINs for one username within 15 min -> that username is locked
--   for 15 min (even the correct PIN is refused while locked). 30 failures
--   from one IP within 15 min -> that IP is locked for 15 min. Unknown
--   usernames are tracked the same way, so lockout behaviour doesn't reveal
--   which usernames exist. Expected time to brute-force one account at the
--   cap: ~1,000,000 / 5 per 15 min ≈ 5.7 years for a full sweep.
--
-- SELF-REGISTRATION (security fix)
--   handle_new_user() (0008) created a profile — with the ROLE taken from
--   client-supplied raw_user_meta_data — for every new auth.users row,
--   including ones created through GoTrue's public sign-up endpoint. With
--   sign-ups enabled on the project, anyone holding the public anon key
--   could sign up as {"role":"admin"} and read every order and price
--   (reproduced on the local stack). Accounts are only ever created by the
--   seed / bootstrap SQL, which runs as the database owner; anything arriving
--   through GoTrue runs as `supabase_auth_admin` and is now refused.
--   Also: profiles are no longer user-editable (nothing in the app edits
--   them, and the PIN lookup is by username).
-- ============================================================================

begin;

-- ── 1. close self-registration ─────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- session_user, not current_user: inside SECURITY DEFINER current_user is
  -- the function owner. GoTrue (sign-up, admin createUser) connects as
  -- supabase_auth_admin; the seed / SQL editor connect as postgres.
  if session_user = 'supabase_auth_admin' then
    raise exception 'self-registration is disabled' using errcode = '42501';
  end if;

  insert into public.profiles (id, username, full_name, role)
  values (
    new.id,
    lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(coalesce(new.email, ''), '@', 1))),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'marketing')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop policy if exists profiles_update_self on public.profiles;
revoke insert, update, delete, truncate on public.profiles from anon, authenticated;

-- ── 2. PINs ────────────────────────────────────────────────────────────────
create table public.account_pins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  pin_hash   text not null,
  updated_at timestamptz not null default now()
);
alter table public.account_pins enable row level security;
revoke all on public.account_pins from anon, authenticated;

-- Sets an account's PIN, makes its GoTrue password an unknowable random
-- value, and signs out its existing sessions. Service role / owner only.
create or replace function public.set_account_pin(p_username text, p_pin text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
begin
  if p_pin !~ '^[0-9]{6}$' then
    raise exception 'PIN must be exactly 6 digits';
  end if;
  select id into v_id from public.profiles where username = lower(trim(p_username));
  if v_id is null then
    raise exception 'no account named %', p_username;
  end if;

  insert into public.account_pins (profile_id, pin_hash, updated_at)
  values (v_id, crypt(p_pin, gen_salt('bf', 10)), now())
  on conflict (profile_id) do update set pin_hash = excluded.pin_hash, updated_at = now();

  update auth.users
     set encrypted_password = crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf')),
         updated_at = now()
   where id = v_id;

  delete from auth.sessions where user_id = v_id;
end $$;
revoke all on function public.set_account_pin(text, text) from public, anon, authenticated;
grant execute on function public.set_account_pin(text, text) to service_role;

-- ── 3. rate limiting ───────────────────────────────────────────────────────
create table public.login_attempts (
  key               text primary key,   -- 'user:<username>' | 'ip:<address>'
  failures          int not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until      timestamptz,
  last_failure_at   timestamptz
);
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from anon, authenticated;

create or replace function public.pin_login_attempt(p_username text, p_pin text, p_ip text)
returns table (ok boolean, user_id uuid, email text, retry_after_seconds int, attempts_left int)
language plpgsql security definer set search_path = public, extensions as $$
declare
  c_user_max constant int := 5;
  c_ip_max   constant int := 30;
  c_window   constant interval := interval '15 minutes';
  c_lock     constant interval := interval '15 minutes';
  v_name  text := lower(trim(coalesce(p_username, '')));
  k_user  text := 'user:' || lower(trim(coalesce(p_username, '')));
  k_ip    text := 'ip:' || coalesce(nullif(trim(p_ip), ''), 'unknown');
  u public.login_attempts;
  i public.login_attempts;
  v_id    uuid;
  v_hash  text;
  v_ok    boolean;
  v_until timestamptz;
begin
  -- opportunistic cleanup of stale rows (tiny table)
  delete from public.login_attempts
   where last_failure_at < now() - interval '1 day'
     and (locked_until is null or locked_until < now());

  insert into public.login_attempts (key) values (k_user), (k_ip) on conflict do nothing;
  -- Row locks serialise concurrent attempts on the same username / IP, so a
  -- burst of parallel guesses can't slip past the cap. Fixed order: no deadlock.
  select * into u from public.login_attempts where key = k_user for update;
  select * into i from public.login_attempts where key = k_ip   for update;

  v_until := greatest(coalesce(u.locked_until, '-infinity'), coalesce(i.locked_until, '-infinity'));
  if v_until > now() then
    return query select false, null::uuid, null::text,
      ceil(extract(epoch from v_until - now()))::int, 0;
    return;
  end if;

  select p.id, ap.pin_hash into v_id, v_hash
    from public.profiles p join public.account_pins ap on ap.profile_id = p.id
   where p.username = v_name;

  if v_hash is null then
    -- unknown username: do the same bcrypt work so timing doesn't reveal it
    perform crypt(coalesce(p_pin, ''), gen_salt('bf', 10));
    v_ok := false;
  else
    v_ok := coalesce(p_pin, '') ~ '^[0-9]{6}$' and crypt(p_pin, v_hash) = v_hash;
  end if;

  if v_ok then
    delete from public.login_attempts where key = k_user;
    return query select true, v_id, (select au.email::text from auth.users au where au.id = v_id), 0, c_user_max;
    return;
  end if;

  -- failure: count it against both keys (a new window if the old one lapsed)
  update public.login_attempts
     set failures          = case when window_started_at < now() - c_window then 1 else failures + 1 end,
         window_started_at = case when window_started_at < now() - c_window then now() else window_started_at end,
         last_failure_at   = now()
   where key in (k_user, k_ip);

  update public.login_attempts
     set locked_until = now() + c_lock, failures = 0, window_started_at = now()
   where (key = k_user and failures >= c_user_max)
      or (key = k_ip   and failures >= c_ip_max);

  select * into u from public.login_attempts where key = k_user;
  select * into i from public.login_attempts where key = k_ip;
  v_until := greatest(coalesce(u.locked_until, '-infinity'), coalesce(i.locked_until, '-infinity'));

  return query select false, null::uuid, null::text,
    case when v_until > now() then ceil(extract(epoch from v_until - now()))::int else 0 end,
    case when v_until > now() then 0 else greatest(c_user_max - u.failures, 0) end;
end $$;
revoke all on function public.pin_login_attempt(text, text, text) from public, anon, authenticated;
grant execute on function public.pin_login_attempt(text, text, text) to service_role;

commit;
