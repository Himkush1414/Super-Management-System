-- ============================================================================
-- ⚠️  REAL PRODUCTION HEAD ADMIN CREDENTIAL — not a shared/guessable demo
-- password. This is the one and only account seeded into the system; every
-- other account (Admin / Manager / Product Supervisor / Maker) is created by
-- real users through the sign-up + approval flow and assigned a role by this
-- Head Admin at approval time. Rotate this password if this file's history
-- is ever exposed. Unlike the old demo seed, do NOT delete this row before
-- production — it is the production Head Admin.
--
-- This file is intentionally SEPARATE from supabase/migrations/ so it can be
-- re-run (or, if ever necessary, swapped) without touching the schema. Runs
-- automatically on `supabase db reset`.
--
--   manikrana831@gmail.com / Manikrana1414
--
-- is_demo_account = false, status = 'active', role = 'head_admin'. The
-- 6-digit-numeric password rule only applies to the sign-up wizard — this
-- row is inserted directly, so it's naturally exempt (never touched by that
-- validator).
-- ============================================================================

do $$
declare
  head_admin_id uuid := '00000000-0000-0000-0000-0000000000a1';
  head_admin_pw text := crypt('Manikrana1414', gen_salt('bf'));
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, recovery_sent_at, last_sign_in_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change,
    email_change_token_new, recovery_token
  )
  values (
    head_admin_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'manikrana831@gmail.com', head_admin_pw, now(), null, now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object(
      'full_name', 'Head Admin',
      'contact_method', 'email',
      'is_demo_account', true -- forces the handle_new_user trigger to create the profile as active, not pending
    ),
    now(), now(), '', '', '', ''
  )
  on conflict (id) do nothing;

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  )
  values (
    head_admin_id, head_admin_id, head_admin_id::text,
    jsonb_build_object('sub', head_admin_id::text, 'email', 'manikrana831@gmail.com', 'email_verified', true),
    'email', now(), now(), now()
  )
  on conflict (provider_id, provider) do nothing;
end $$;

-- The handle_new_user trigger created the profile with role='maker' (its
-- inert default) and is_demo_account=true/active. Fix it up to the real
-- Head Admin row: role='head_admin', is_demo_account=false, active.
update public.profiles
   set role = 'head_admin', status = 'active', is_demo_account = false, full_name = 'Head Admin'
 where id = '00000000-0000-0000-0000-0000000000a1';
