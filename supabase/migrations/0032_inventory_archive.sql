-- ============================================================================
-- NR Industries — 0032_inventory_archive.sql
--
-- The Archive tab: list archived products, restore them (one or many), and
-- permanently delete an archived product that has NO history (a product
-- added by mistake).
--
-- ADDITIVE, with ONE deliberate, narrow exception (stated here so nobody
-- has to find it):
--   * new: table inv_product_tombstones (append-only), functions
--     inv_archive_list, inv_restore_products, inv_delete_archived_product,
--     inv_guard_product_delete, inv_guard_product_log_change;
--   * CHANGED: the two existing triggers that refuse deletes on
--     inv_products (inv_products_no_delete) and on inv_product_log
--     (inv_product_log_append_only) now call the two new guard functions
--     instead of inv_forbid_change(). The guards refuse exactly what
--     inv_forbid_change() refused, with the same message, EXCEPT one case:
--     a DELETE of a product (and of its own detail-change log rows) inside
--     the transaction that has just written that product's tombstone, which
--     only inv_delete_archived_product() does, and only for an archived
--     product with no ledger entry, no stock count and no month snapshot.
--     Every UPDATE on inv_product_log is still refused; TRUNCATE is still
--     refused on every table (those triggers are not touched).
--     inv_forbid_change() itself is unchanged and still guards every other table.
--   No existing row is updated, deleted or backfilled by this migration.
-- ============================================================================

begin;

-- ── 1. tombstones: a full copy of every deleted product ────────────────────
create table if not exists public.inv_product_tombstones (
  id           bigint generated always as identity primary key,
  product_id   uuid not null,                 -- no FK: the product row is gone
  serial_no    text not null,
  product      jsonb not null,                -- the whole inv_products row
  product_log  jsonb not null default '[]'::jsonb, -- its detail-change log rows
  deleted_by   uuid,
  deleted_at   timestamptz not null default now(),
  deleted_txid bigint not null default txid_current()
);
create index if not exists inv_product_tombstones_product on public.inv_product_tombstones (product_id, deleted_txid);

create or replace trigger inv_product_tombstones_append_only
  before update or delete on public.inv_product_tombstones for each row execute function public.inv_forbid_change();
create or replace trigger inv_product_tombstones_no_truncate
  before truncate on public.inv_product_tombstones for each statement execute function public.inv_forbid_change();

alter table public.inv_product_tombstones enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inv_product_tombstones'
                                            and policyname = 'inv_product_tombstones_read') then
    create policy inv_product_tombstones_read on public.inv_product_tombstones for select to authenticated
      using ((select public.inv_can_view()));
  end if;
end $$;
revoke all on table public.inv_product_tombstones from anon, authenticated;
grant select on table public.inv_product_tombstones to authenticated;

-- ── 2. the delete guards ───────────────────────────────────────────────────

-- "A tombstone for this product was written in this very transaction."
create or replace function public.inv_tombstoned_now(p_product_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.inv_product_tombstones
                  where product_id = p_product_id and deleted_txid = txid_current())
$$;

-- inv_products: deletes refused (as before), except a tombstoned product.
create or replace function public.inv_guard_product_delete()
returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and public.inv_tombstoned_now(old.id) then
    return old;
  end if;
  raise exception 'inventory records are never % (%): archive or reverse instead',
    case tg_op when 'DELETE' then 'deleted' when 'TRUNCATE' then 'truncated' else 'edited' end,
    tg_table_name
    using errcode = '42501';
end $$;

-- inv_product_log: updates and deletes refused (as before), except the
-- deletion of a tombstoned product's own rows (copied into its tombstone).
create or replace function public.inv_guard_product_log_change()
returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and public.inv_tombstoned_now(old.product_id) then
    return old;
  end if;
  raise exception 'inventory records are never % (%): archive or reverse instead',
    case tg_op when 'DELETE' then 'deleted' when 'TRUNCATE' then 'truncated' else 'edited' end,
    tg_table_name
    using errcode = '42501';
end $$;

-- the two triggers now use the guards (same names, same events)
create or replace trigger inv_products_no_delete
  before delete on public.inv_products
  for each row execute function public.inv_guard_product_delete();
create or replace trigger inv_product_log_append_only
  before update or delete on public.inv_product_log
  for each row execute function public.inv_guard_product_log_change();

-- ── 3. reads ───────────────────────────────────────────────────────────────

-- "Has history": any ledger entry, stock count or month snapshot. Such a
-- product can only be restored, never deleted.
create or replace function public.inv_has_history(p_product_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.inv_transactions where product_id = p_product_id)
      or exists (select 1 from public.inv_stock_counts where product_id = p_product_id)
      or exists (select 1 from public.inv_month_snapshots where product_id = p_product_id)
      or exists (select 1 from public.inv_month_snapshots2 where product_id = p_product_id)
$$;

-- The Archive tab: every archived product with its archived date, its last
-- balance and whether it has history. SECURITY INVOKER: RLS applies. It
-- closes ended months first (inv_rollover2, like the main page), so a
-- product that lived through an ended month always has its snapshot, and
-- with it history.
create or replace function public.inv_archive_list()
returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
begin
  if not public.inv_can_view() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.inv_rollover2();
  return jsonb_build_object(
    'fields', jsonb_build_array('id', 'serial_no', 'description', 'specification', 'archived_at', 'balance', 'has_history', 'entries'),
    'rows', (select coalesce(jsonb_agg(jsonb_build_array(
                p.id, p.serial_no, p.description, p.specification, p.archived_at,
                trim_scale(p.opening_qty + coalesce(t.s, 0) + coalesce(c.s, 0))::text,
                (coalesce(t.n, 0) + coalesce(c.n, 0)) > 0
                  or exists (select 1 from public.inv_month_snapshots s where s.product_id = p.id)
                  or exists (select 1 from public.inv_month_snapshots2 s where s.product_id = p.id),
                coalesce(t.n, 0) + coalesce(c.n, 0))
              order by p.archived_at desc nulls last, p.serial_no), '[]'::jsonb)
               from public.inv_products p
               left join lateral (select sum(x.delta) s, count(*) n from public.inv_transactions x where x.product_id = p.id) t on true
               left join lateral (select sum(x.adjustment) s, count(*) n from public.inv_stock_counts x where x.product_id = p.id) c on true
              where not p.is_active),
    'deleted', (select count(*) from public.inv_product_tombstones)
  );
end $$;

-- ── 4. restore (inventory only) ────────────────────────────────────────────
-- One or many archived products back to the list, in one transaction. The
-- ledger and balances are not touched (inv_set_product_active only flips
-- is_active and logs it). Pending rule (0031, derived): a restored product
-- that existed before this month and has no stock count this month is
-- pending until counted; one added this month comes back confirmed.
create or replace function public.inv_restore_products(p_product_ids uuid[])
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  r       record;
  v_n     int := 0;
  v_same  int := 0;
  v_found int;
begin
  if not public.inv_can_manage() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_product_ids is null or coalesce(array_length(p_product_ids, 1), 0) = 0 then
    return jsonb_build_object('status', 'invalid', 'message', 'No products chosen.');
  end if;
  if array_length(p_product_ids, 1) > 5000 then
    return jsonb_build_object('status', 'invalid', 'message', 'Too many products at once.');
  end if;
  select count(*) into v_found from public.inv_products where id = any(p_product_ids);
  for r in select id, is_active from public.inv_products where id = any(p_product_ids) order by id for update loop
    if r.is_active then
      v_same := v_same + 1;
    else
      perform public.inv_set_product_active(r.id, true);
      v_n := v_n + 1;
    end if;
  end loop;
  return jsonb_build_object('status', 'ok', 'restored', v_n, 'already_active', v_same,
                            'not_found', (select count(distinct x) from unnest(p_product_ids) x) - v_found);
end $$;

-- ── 5. permanent delete (inventory only; never used on products with history)
-- Only an ARCHIVED product with no ledger entry, no stock count and no
-- month snapshot, after the serial number is typed to confirm. The whole
-- row and its detail-change log are copied into inv_product_tombstones
-- first, in the same transaction; the guards (section 2) let exactly that
-- product's rows go. {status: ok | invalid | not_found | active | has_history}
create or replace function public.inv_delete_archived_product(p_product_id uuid, p_confirm_serial text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_p  public.inv_products;
  v_id bigint;
begin
  if not public.inv_can_manage() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  -- close any ended month first: a product that existed in it gets its
  -- snapshot (history), so a closed month's figures never lose a product
  perform public.inv_rollover2();
  -- shared ledger lock: no rollover snapshot can appear meanwhile
  perform public.inv_ledger_lock(false);
  select * into v_p from public.inv_products where id = p_product_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'message', 'This product no longer exists.');
  end if;
  if v_p.is_active then
    return jsonb_build_object('status', 'active', 'message', 'Archive the product first.');
  end if;
  if p_confirm_serial is null or upper(btrim(p_confirm_serial)) <> upper(v_p.serial_no) then
    return jsonb_build_object('status', 'invalid', 'message', 'Type the serial number exactly to confirm.');
  end if;
  if public.inv_has_history(v_p.id) then
    return jsonb_build_object('status', 'has_history', 'message', 'Has history, can only be restored.');
  end if;

  insert into public.inv_product_tombstones (product_id, serial_no, product, product_log, deleted_by)
  values (v_p.id, v_p.serial_no, to_jsonb(v_p),
          (select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]'::jsonb)
             from public.inv_product_log l where l.product_id = v_p.id),
          auth.uid())
  returning id into v_id;

  delete from public.inv_product_log where product_id = v_p.id;
  delete from public.inv_products where id = v_p.id;
  return jsonb_build_object('status', 'ok', 'tombstone_id', v_id, 'serial_no', v_p.serial_no);
end $$;

-- ── 6. who may call what ───────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['inv_archive_list()', 'inv_restore_products(uuid[])',
                           'inv_delete_archived_product(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['inv_tombstoned_now(uuid)', 'inv_has_history(uuid)',
                           'inv_guard_product_delete()', 'inv_guard_product_log_change()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

commit;
