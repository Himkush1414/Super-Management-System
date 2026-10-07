-- ============================================================================
-- NR Industries — supabase/scripts/0023_move_check.sql   (NOT a migration)
-- READ-ONLY. Run before and after 0023_move_stage1_orders.sql: every row of
-- the output must be identical. Like 0021_snapshot.sql, but orders are
-- hashed WITHOUT stage / stage_ready_at / updated_at (the only columns the
-- move may change), and the move's own system history rows (1 -> 2,
-- changed_by null) are left out of the stage-history hash.
-- ============================================================================
select 'orders (all but stage, stage_ready_at, updated_at)' as what, count(*) as rows,
       md5(coalesce(string_agg(concat_ws('|', id, created_by, product_name, client_name, ship_to,
             transformer_rating, quantity, price, additional_amount, expected_delivery, description,
             status, whatsapp_group_created, whatsapp_group_id, created_at,
             review_started_at, review_started_by), E'\n' order by id), '')) as fingerprint
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
select 'order_stage_events (without the move''s system rows)', count(*),
       md5(coalesce(string_agg(concat_ws('|', id, order_id, from_stage, to_stage, changed_by, created_at),
             E'\n' order by id), ''))
  from public.order_stage_events
 where not (from_stage = 1 and to_stage = 2 and changed_by is null)
union all
select 'notifications', count(*), md5(coalesce(string_agg(id::text, ',' order by id), ''))
  from public.notifications
union all
select 'profiles', count(*), md5(coalesce(string_agg(concat_ws('|', id, username, role), ',' order by id), ''))
  from public.profiles;
