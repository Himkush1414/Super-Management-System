-- ============================================================================
-- NR Industries — 0011_realtime_publication.sql
--
-- The client already subscribes to postgres_changes on `orders` and
-- `order_stage_events` (see components/dashboard/LiveRefresh.tsx, used from
-- the orders list and order detail pages) and on `notifications` (the
-- notification bell). None of that ever fires for orders/stage
-- events/settings because migration 0004 only ever added the *old*
-- (now-dropped) tables — projects, tasks, messages, signup_requests — plus
-- notifications to the `supabase_realtime` publication. The 0008 rewrite
-- introduced orders/order_stage_events/production_settings but never added
-- them to the publication, so Postgres never emits logical-replication
-- events for them and every "live" subscription on those tables silently
-- receives nothing — the app only ever updated on a manual refresh.
--
-- Confirmed on the local stack: `select tablename from pg_publication_tables
-- where pubname = 'supabase_realtime'` returned only `notifications` before
-- this migration.
-- ============================================================================

begin;

do $$ begin
  execute 'alter publication supabase_realtime add table public.orders';
exception when duplicate_object then null; end $$;

do $$ begin
  execute 'alter publication supabase_realtime add table public.order_stage_events';
exception when duplicate_object then null; end $$;

do $$ begin
  execute 'alter publication supabase_realtime add table public.production_settings';
exception when duplicate_object then null; end $$;

commit;
