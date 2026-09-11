-- ============================================================================
-- NR Industries — 0010_price_column_lockdown.sql
--
-- Price isolation (spec §3) was only enforced by the `order_feed` VIEW's
-- CASE expression. RLS is row-level only — the `orders_production_assigned`
-- policy grants a production account SELECT on its assigned order ROWS with
-- no column restriction, so the *raw* price was still readable straight off
-- the base table via PostgREST (e.g. `GET /rest/v1/orders?select=price`),
-- bypassing order_feed entirely. Confirmed live against the local stack
-- before this fix: a production account's own PostgREST session could read
-- full prices off `public.orders` even though order_feed correctly nulled
-- them.
--
-- Fix: revoke column-level SELECT on `orders.price` from the API-facing
-- roles, and move the price computation into a SECURITY DEFINER function
-- that reads the column with its own (elevated) privileges. Because the
-- view now calls the function instead of referencing `o.price` directly, it
-- no longer needs the invoking role to hold SELECT on that column — while
-- direct queries against the base table for that column are now rejected
-- outright. Verified both properties empirically after applying this.
-- ============================================================================

begin;

-- Supabase grants `SELECT` on every public-schema table to `anon` and
-- `authenticated` at CREATE TABLE time (via its own default-privileges
-- bootstrap, applied before any of our migrations run). That whole-table
-- grant authorizes every column, so a column-level `revoke select (price)`
-- alone does nothing while it's still in place — confirmed empirically: the
-- column-level revoke alone left `/rest/v1/orders?select=price` returning
-- the real value. The table-wide SELECT has to come off first, then be
-- re-granted column-by-column, leaving `price` out.
revoke select on public.orders from authenticated, anon;
grant select (
  id, created_by, assigned_to,
  product_name, quality, quantity, power_type, description,
  stage, status,
  whatsapp_group_created, whatsapp_group_id, production_phone,
  created_at, updated_at, stage_ready_at
) on public.orders to authenticated;

create or replace function public.order_price_for_viewer(p_order_id uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select case when public.is_admin_tier() or o.created_by = auth.uid()
              then o.price else null end
  from public.orders o
  where o.id = p_order_id
$$;

revoke all on function public.order_price_for_viewer(uuid) from public;
grant execute on function public.order_price_for_viewer(uuid) to authenticated;

create or replace view public.order_feed with (security_invoker = true) as
select
  o.id, o.created_by, o.assigned_to,
  o.product_name, o.quality, o.quantity, o.power_type, o.description,
  o.stage, o.status,
  public.order_price_for_viewer(o.id) as price,
  o.whatsapp_group_created, o.whatsapp_group_id, o.production_phone,
  o.created_at, o.updated_at,
  o.stage_ready_at
from public.orders o;

commit;
