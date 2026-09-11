-- ============================================================================
-- NR Industries — 0009_stage_timer.sql
--
-- Adds server-persisted timer state for the production stage-advance flow:
-- each stage transition opens a 3-minute window before the NEXT transition
-- is allowed. Storing the deadline on the row (rather than in client state)
-- means a page refresh mid-countdown resumes from the correct remaining
-- time instead of resetting, and the server can reject an early advance
-- even if a client is tampered with.
--
-- `stage_ready_at` is null when the assigned production account may advance
-- immediately (a freshly-dispatched order sitting at stage 1, or an order
-- whose timer has already elapsed and simply hasn't been re-checked).
-- ============================================================================

begin;

alter table public.orders
  add column stage_ready_at timestamptz;

create or replace view public.order_feed with (security_invoker = true) as
select
  o.id, o.created_by, o.assigned_to,
  o.product_name, o.quality, o.quantity, o.power_type, o.description,
  o.stage, o.status,
  case when public.is_admin_tier() or o.created_by = auth.uid()
       then o.price else null end as price,
  o.whatsapp_group_created, o.whatsapp_group_id, o.production_phone,
  o.created_at, o.updated_at,
  o.stage_ready_at
from public.orders o;

commit;
