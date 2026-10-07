-- ============================================================================
-- NR Industries — supabase/scripts/0021_snapshot.sql   (NOT a migration)
--
-- Read-only fingerprint of every order and product that exists BEFORE 0021.
-- Run it right before and right after applying 0021: every row must be
-- identical. Only the columns that existed before 0021 are hashed (0021 only
-- adds columns), so a match proves no existing value was changed, and the
-- counts prove nothing was added or removed.
-- ============================================================================
select 'orders' as what, count(*) as rows,
       md5(coalesce(string_agg(concat_ws('|', id, created_by, product_name, client_name,
             transformer_rating, quantity, price, expected_delivery, description, stage,
             status, whatsapp_group_created, whatsapp_group_id, created_at, updated_at,
             stage_ready_at), E'\n' order by id), '')) as fingerprint
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
select 'notifications', count(*), md5(coalesce(string_agg(id::text, ',' order by id), ''))
  from public.notifications
union all
select 'profiles', count(*), md5(coalesce(string_agg(concat_ws('|', id, username, role), ',' order by id), ''))
  from public.profiles;
