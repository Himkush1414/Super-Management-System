-- ============================================================================
-- NR Industries — supabase/scripts/0023_stage1_preview.sql   (NOT a migration)
-- READ-ONLY. Every order now at Stage 1 and what 0023_move_stage1_orders.sql
-- would do with it: MOVE to Stage 2, or STAY at Stage 1 because an assigned
-- production member has no phone number linked yet.
-- ============================================================================
select o.id, o.product_name, o.client_name, o.status,
       to_char(o.created_at at time zone 'Asia/Kolkata', 'DD/MM/YYYY HH24:MI') as punched_ist,
       (select string_agg(p.username || case when s.phone is not null and s.confirmed_at is not null
                                             then ' (phone linked)' else ' (NO PHONE)' end,
                          ', ' order by p.username)
          from public.order_assignees a
          join public.profiles p on p.id = a.profile_id
          left join public.production_settings s on s.profile_id = a.profile_id
         where a.order_id = o.id) as production,
       case when exists (select 1 from public.order_assignees a
                           left join public.production_settings s on s.profile_id = a.profile_id
                          where a.order_id = o.id and (s.phone is null or s.confirmed_at is null))
            then 'STAY at Stage 1' else 'MOVE to Stage 2' end as action
  from public.orders o
 where o.stage = 1
 order by o.created_at;
