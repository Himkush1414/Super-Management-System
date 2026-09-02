-- ============================================================================
-- ⚠️  DEMO ACCOUNTS — DELETE BEFORE PRODUCTION USE.
-- Shared / guessable passwords. Do NOT leave active on a reachable deployment.
-- This file is intentionally SEPARATE from supabase/migrations/ so it can be
-- dropped without touching the schema. Runs automatically on `supabase db reset`.
--
-- All five accounts: password  DemoPass123!
--   headadmin@demo.nrindustries.local
--   admin@demo.nrindustries.local
--   manager@demo.nrindustries.local
--   supervisor@demo.nrindustries.local
--   maker@demo.nrindustries.local
--
-- is_demo_account = true  ->  status forced to 'active', OTP/2FA skipped.
-- ============================================================================

-- Fixed UUIDs so downstream seed rows can reference them.
--   head admin   00000000-0000-0000-0000-0000000000a1
--   admin        00000000-0000-0000-0000-0000000000a2
--   manager      00000000-0000-0000-0000-0000000000a3
--   supervisor   00000000-0000-0000-0000-0000000000a4
--   maker        00000000-0000-0000-0000-0000000000a5

do $$
declare
  demo_pw text := crypt('DemoPass123!', gen_salt('bf'));
  rec record;
begin
  for rec in
    select * from (values
      ('00000000-0000-0000-0000-0000000000a1'::uuid, 'headadmin@demo.nrindustries.local',  'Nisha Rao',      'head_admin'),
      ('00000000-0000-0000-0000-0000000000a2'::uuid, 'admin@demo.nrindustries.local',      'Arun Mehta',     'admin'),
      ('00000000-0000-0000-0000-0000000000a3'::uuid, 'manager@demo.nrindustries.local',    'Priya Nair',     'manager'),
      ('00000000-0000-0000-0000-0000000000a4'::uuid, 'supervisor@demo.nrindustries.local', 'Vikram Desai',   'product_supervisor'),
      ('00000000-0000-0000-0000-0000000000a5'::uuid, 'maker@demo.nrindustries.local',      'Sunil Kamble',   'maker')
    ) as t(id, email, full_name, role)
  loop
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, recovery_sent_at, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    )
    values (
      rec.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      rec.email, demo_pw, now(), null, now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'full_name', rec.full_name,
        'requested_role', rec.role,
        'contact_method', 'email',
        'is_demo_account', true
      ),
      now(), now(), '', '', '', ''
    )
    on conflict (id) do nothing;

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    )
    values (
      rec.id, rec.id, rec.id::text,
      jsonb_build_object('sub', rec.id::text, 'email', rec.email, 'email_verified', true),
      'email', now(), now(), now()
    )
    on conflict (provider_id, provider) do nothing;
  end loop;
end $$;

-- The handle_new_user trigger created the profiles as is_demo_account/active.
-- Make sure roles are exactly what we want (trigger downgrades admin tiers).
update public.profiles set role = 'head_admin', status = 'active'
  where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'admin', status = 'active'
  where id = '00000000-0000-0000-0000-0000000000a2';
update public.profiles set role = 'manager', status = 'active'
  where id = '00000000-0000-0000-0000-0000000000a3';
update public.profiles set role = 'product_supervisor', status = 'active'
  where id = '00000000-0000-0000-0000-0000000000a4';
update public.profiles set role = 'maker', status = 'active'
  where id = '00000000-0000-0000-0000-0000000000a5';

-- ---------------------------------------------------------------------------
-- Sample projects so Manager / Supervisor / Maker dashboards aren't empty.
-- ---------------------------------------------------------------------------
insert into public.projects (
  id, name, client_name, client_contact, status,
  transformer_kind, capacity_kva, primary_voltage, secondary_voltage,
  phase, frequency_hz, cooling_type, impedance_pct,
  requirements_notes, quantity, unit_price, material_cost, labour_cost, margin,
  assigned_manager, created_by
) values
(
  '00000000-0000-0000-0000-00000000d001',
  'MSEB Feeder Upgrade — Pune West', 'Maharashtra State Electricity Board',
  'projects@mahadiscom.example', 'in_production',
  'distribution', 1000.00, '11 kV', '433 V', 3, 50, 'ONAN', 4.75,
  'IS 1180 compliant. Copper windings. Delivery in 6 weeks. Third-party inspection required before dispatch.',
  4, 812000.00, 480000.00, 120000.00, 90000.00,
  '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a3'
),
(
  '00000000-0000-0000-0000-00000000d002',
  'Tata Motors Plant — Substation 3', 'Tata Motors Ltd.',
  'facilities@tatamotors.example', 'quality_check',
  'power', 5000.00, '33 kV', '11 kV', 3, 50, 'ONAF', 6.25,
  'OLTC with AVR. Marshalling box IP55. Buchholz + PRV + WTI + OTI. FAT witnessed.',
  1, 4250000.00, 2600000.00, 540000.00, 610000.00,
  '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a3'
);

-- Assignments: supervisor + maker onto both projects; manager already on project row.
insert into public.project_assignments (project_id, user_id, role_at_assignment, assigned_by) values
('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000a4', 'product_supervisor', '00000000-0000-0000-0000-0000000000a3'),
('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000a5', 'maker', '00000000-0000-0000-0000-0000000000a3'),
('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000a4', 'product_supervisor', '00000000-0000-0000-0000-0000000000a3'),
('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000a5', 'maker', '00000000-0000-0000-0000-0000000000a3')
on conflict do nothing;

-- Tasks for the Maker.
insert into public.tasks (project_id, title, description, assigned_to, status, due_date, created_by) values
('00000000-0000-0000-0000-00000000d001', 'Core stacking — Unit 1',
 'Stack CRGO laminations per drawing NR-DT-1000-C. Target stacking factor ≥ 0.97.',
 '00000000-0000-0000-0000-0000000000a5', 'in_progress', current_date + 5,
 '00000000-0000-0000-0000-0000000000a3'),
('00000000-0000-0000-0000-00000000d001', 'LV winding — Units 1-2',
 'Foil winding, LV. Verify inter-layer insulation. Log turns count.',
 '00000000-0000-0000-0000-0000000000a5', 'assigned', current_date + 9,
 '00000000-0000-0000-0000-0000000000a3'),
('00000000-0000-0000-0000-00000000d002', 'Tank fabrication + leak test',
 'Weld tank, pressure test at 0.35 kg/cm² for 30 min. Zero leaks.',
 '00000000-0000-0000-0000-0000000000a5', 'completed', current_date - 2,
 '00000000-0000-0000-0000-0000000000a3');

-- A couple of chat messages so the thread isn't blank.
insert into public.messages (project_id, sender_id, body) values
('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000a3',
 'Client confirmed the third-party inspector will visit in week 5. Please keep the ITP updated.'),
('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000a4',
 'ITP is current. Core stacking QA checkpoint scheduled for Thursday.'),
('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000a5',
 'Core stacking for Unit 1 is ~60% done. On track for Thursday.');

-- One pending signup request so the approvals queue has content on first login.
do $$
declare demo_pending uuid := '00000000-0000-0000-0000-0000000000b1';
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    demo_pending, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'newhire@demo.nrindustries.local', crypt('DemoPass123!', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Deepa Iyer","requested_role":"maker","contact_method":"email"}'::jsonb,
    now(), now(), '', '', '', ''
  ) on conflict (id) do nothing;

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
  values (demo_pending, demo_pending, demo_pending::text,
          jsonb_build_object('sub', demo_pending::text, 'email', 'newhire@demo.nrindustries.local', 'email_verified', true),
          'email', now(), now())
  on conflict (provider_id, provider) do nothing;
end $$;
