-- ============================================================================
-- NR Industries — 0007_cron_cleanup.sql
-- Hourly invocation of the cleanup-direct-messages Edge Function, which
-- hard-deletes direct-message conversations (rows + Storage voice notes)
-- 60h after the last message. Postgres alone can delete the DB rows, but
-- only the Edge Function (via the Storage API) can purge the backing files
-- in the `voice-notes` bucket, so this schedules an HTTP call to it.
--
-- ⚠️  MANUAL STEP REQUIRED — do this once, after applying this migration,
-- from the Supabase SQL editor on the hosted project (never commit the key):
--
--   select vault.create_secret(
--     '<paste the project''s service_role key here>',
--     'cleanup_fn_service_key'
--   );
--
-- Then deploy the function once:
--   npx supabase functions deploy cleanup-direct-messages
--
-- Replace <PROJECT_REF> below with the actual project ref (ywzwzrzlittjiosskmcy)
-- before applying this migration on the hosted project.
-- ============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- cron.schedule() upserts by job name (pg_cron >= 1.4), so re-running this
-- migration is safe and simply re-registers the same job definition.
select cron.schedule(
  'cleanup-direct-messages',
  '0 * * * *', -- hourly, on the hour
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/cleanup-direct-messages',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || vault.decrypted_secret('cleanup_fn_service_key'),
                 'Content-Type', 'application/json'
               ),
    body    := '{}'::jsonb
  );
  $$
);
