-- ============================================================================
-- NR Industries — seed.sql   (runs automatically on `supabase db reset`)
--
-- The ONLY way accounts enter the system. There is no sign-up, no OTP, no
-- self-registration. Exactly these fixed accounts exist.
--
-- Login field is the USERNAME. Supabase Auth needs an email internally, so
-- each account is stored as <username>@nr.local in auth.users — that address
-- is never shown or typed anywhere in the app.
--
-- Passwords are bcrypt-hashed via crypt()/gen_salt('bf'), which is exactly
-- the scheme Supabase Auth (GoTrue) verifies against on sign-in.
--
--   head_admin  / Manikrana1414
--   admin       / nrindustry1414
--   marketing1  / Mark@NR1        marketing2 / Mark@NR102
--   marketing3  / Mark@NR1003     marketing4 / Mark@NR1004
--   production1 / Pro@NR1         production2 / Pro@NR102
--   production3 / Pro@NR1003      production4 / Pro@NR1004
-- ============================================================================

do $$
declare
  acct record;
  uid  uuid;
begin
  for acct in
    select * from (values
      ('head_admin',  'Manikrana1414',  'head_admin', 'Manik Rana'),
      ('admin',       'nrindustry1414', 'admin',      'Administrator'),
      ('marketing1',  'Mark@NR1',       'marketing',  'Marketing 1'),
      ('marketing2',  'Mark@NR102',     'marketing',  'Marketing 2'),
      ('marketing3',  'Mark@NR1003',    'marketing',  'Marketing 3'),
      ('marketing4',  'Mark@NR1004',    'marketing',  'Marketing 4'),
      ('production1', 'Pro@NR1',        'production',  'Production 1'),
      ('production2', 'Pro@NR102',      'production',  'Production 2'),
      ('production3', 'Pro@NR1003',     'production',  'Production 3'),
      ('production4', 'Pro@NR1004',     'production',  'Production 4')
    ) as t(username, password, role, full_name)
  loop
    uid := gen_random_uuid();

    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    )
    values (
      uid,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      acct.username || '@nr.local',
      crypt(acct.password, gen_salt('bf')),
      now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'username',  acct.username,
        'full_name', acct.full_name,
        'role',      acct.role
      ),
      now(), now(), '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    )
    values (
      gen_random_uuid(), uid, uid::text,
      jsonb_build_object(
        'sub', uid::text,
        'email', acct.username || '@nr.local',
        'email_verified', true
      ),
      'email', now(), now(), now()
    );

    -- handle_new_user() already inserted the profile from raw_user_meta_data;
    -- make role/username/name authoritative here in case that ever changes.
    update public.profiles
       set username  = acct.username,
           full_name = acct.full_name,
           role      = acct.role::user_role
     where id = uid;
  end loop;
end $$;
