-- ============================================================================
-- NR Management (mobile app) — verify.sql   READ-ONLY
-- Run after 001 + 002. Every row of the result should say ok = true.
-- ============================================================================
select 'device_tokens table exists' as check, to_regclass('public.device_tokens') is not null as ok
union all
select 'device_tokens has RLS on', (select relrowsecurity from pg_class where oid = 'public.device_tokens'::regclass)
union all
select 'device_tokens has 4 own-row policies',
       (select count(*) = 4 from pg_policies where schemaname = 'public' and tablename = 'device_tokens')
union all
select 'anon cannot read device_tokens', not has_table_privilege('anon', 'public.device_tokens', 'select')
union all
select 'register_device_token: authenticated only',
       has_function_privilege('authenticated', 'public.register_device_token(text,text,text)', 'execute')
       and not has_function_privilege('anon', 'public.register_device_token(text,text,text)', 'execute')
union all
select 'unregister_device_token callable after sign-out',
       has_function_privilege('anon', 'public.unregister_device_token(text)', 'execute')
union all
select 'order_push_log exists, closed to API roles',
       to_regclass('public.order_push_log') is not null
       and not has_table_privilege('authenticated', 'public.order_push_log', 'select')
union all
select 'pg_net enabled', exists (select 1 from pg_extension where extname = 'pg_net')
union all
select 'vault secret nr_push_webhook_secret present',
       exists (select 1 from vault.secrets where name = 'nr_push_webhook_secret')
union all
select 'trigger orders_new_order_push enabled',
       exists (select 1 from pg_trigger
                where tgrelid = 'public.orders'::regclass
                  and tgname = 'orders_new_order_push' and tgenabled = 'O');

-- After the first real order: what happened (no prices, ids and counts only)
select order_id, claimed_at, recipients, devices, sent, failed, error, finished_at
  from public.order_push_log order by claimed_at desc limit 10;

-- Recent HTTP responses from the Edge Function (pg_net keeps them ~6 hours)
select id, status_code, left(content::text, 200) as content, created
  from net._http_response order by created desc limit 10;
