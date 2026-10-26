-- ============================================================================
-- NR Management (mobile app) — 002_new_order_push.sql
--
-- ADDITIVE ONLY. Run after 001_device_tokens.sql and after the Edge
-- Function `notify-new-order` is deployed (docs/mobile-push-setup.md).
--
-- New objects:
--   • public.order_push_log           one row per order that was notified;
--                                      its primary key is what makes a second
--                                      notification for the same order
--                                      impossible
--   • public.notify_new_order_push()  trigger function
--   • trigger orders_new_order_push   AFTER INSERT ON public.orders
--
-- It reads nothing from and writes nothing to any order. The trigger only
-- queues one HTTPS request (pg_net) carrying the new order's id; the request
-- is sent after the transaction commits, so the Edge Function sees the
-- order together with its products and production assignees. If anything
-- about the notification fails — pg_net missing, secret missing, anything —
-- the trigger swallows it with a WARNING: punching an order can never fail
-- because of notifications.
--
-- This is the same mechanism as a Dashboard "Database Webhook" (both are a
-- pg_net call from an AFTER INSERT trigger), written out so the failure
-- guard above and the secret header are explicit.
--
-- Prerequisite (once, by hand, NOT in this file): store the webhook secret
-- in Vault — the same value as the function's NR_WEBHOOK_SECRET:
--   select vault.create_secret('<the secret>', 'nr_push_webhook_secret',
--                              'NR Management new-order push webhook');
-- ============================================================================

begin;

create extension if not exists pg_net with schema extensions;

create table if not exists public.order_push_log (
  -- deliberately no foreign key: this table must never take part in (or
  -- slow down) deleting an order
  order_id    uuid primary key,
  claimed_at  timestamptz not null default now(),
  recipients  int,
  devices     int,
  sent        int,
  failed      int,
  error       text,
  finished_at timestamptz
);
alter table public.order_push_log enable row level security;
-- no policies: only the Edge Function (service role) reads or writes it
revoke all on public.order_push_log from anon, authenticated;

create or replace function public.notify_new_order_push()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_secret text;
begin
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = 'nr_push_webhook_secret'
     limit 1;
    if v_secret is null then
      raise warning 'notify_new_order_push: vault secret nr_push_webhook_secret is missing; no push for order %', new.id;
      return new;
    end if;

    perform net.http_post(
      url                  := 'https://ywzwzrzlittjiosskmcy.supabase.co/functions/v1/notify-new-order',
      body                 := jsonb_build_object(
                                'type', 'INSERT', 'schema', 'public', 'table', 'orders',
                                'record', jsonb_build_object('id', new.id)),
      headers              := jsonb_build_object(
                                'Content-Type', 'application/json',
                                'x-nr-webhook-secret', v_secret),
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'notify_new_order_push: not queued for order %: %', new.id, sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.notify_new_order_push() from public, anon, authenticated;

drop trigger if exists orders_new_order_push on public.orders;
create trigger orders_new_order_push
  after insert on public.orders
  for each row execute function public.notify_new_order_push();

commit;
