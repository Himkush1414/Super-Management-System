-- ============================================================================
-- NR Industries — supabase/scripts/0024_snapshot.sql   (NOT a migration)
-- READ-ONLY. Run right before and right after 0024: every row must be
-- identical. Every column of every order / product / assignee / history row,
-- plus notifications, profiles, PINs and auth users — so it also proves the
-- dispatcher accounts and their PINs are untouched.
-- ============================================================================
select 'orders' as what, count(*) as rows,
       md5(coalesce(string_agg(concat_ws('|', id, created_by, product_name, client_name, ship_to,
             transformer_rating, quantity, price, additional_amount, expected_delivery, description,
             stage, status, whatsapp_group_created, whatsapp_group_id, created_at, updated_at,
             stage_ready_at, review_started_at, review_started_by), E'\n' order by id), '')) as fingerprint
  from public.orders
union all
select 'order_items', count(*),
       md5(coalesce(string_agg(concat_ws('|', id, order_id, position, product_name,
             transformer_rating, quantity, price, feat, description, created_at),
             E'\n' order by id), ''))
  from public.order_items
union all
select 'order_assignees', count(*),
       md5(coalesce(string_agg(concat_ws('|', order_id, profile_id, created_at),
             E'\n' order by order_id, profile_id), ''))
  from public.order_assignees
union all
select 'order_stage_events', count(*),
       md5(coalesce(string_agg(concat_ws('|', id, order_id, from_stage, to_stage, changed_by, created_at),
             E'\n' order by id), ''))
  from public.order_stage_events
union all
select 'notifications', count(*), md5(coalesce(string_agg(concat_ws('|', id, user_id, title, read_at, created_at), ',' order by id), ''))
  from public.notifications
union all
select 'profiles', count(*),
       md5(coalesce(string_agg(concat_ws('|', id, username, role, full_name, real_name), ',' order by id), ''))
  from public.profiles
union all
select 'account_pins', count(*),
       md5(coalesce(string_agg(concat_ws('|', profile_id, pin_hash, updated_at), ',' order by profile_id), ''))
  from public.account_pins
union all
select 'auth.users', count(*), md5(coalesce(string_agg(concat_ws('|', id, email), ',' order by id), ''))
  from auth.users
union all
select 'dispatcher accounts', count(*), md5(coalesce(string_agg(username, ',' order by username), ''))
  from public.profiles where role = 'dispatcher';
