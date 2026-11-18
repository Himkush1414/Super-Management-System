-- ============================================================================
-- NR Industries — 0031_inventory_month_balance.sql
--
-- Month-start balance (stock count) for the Inventory module.
--
-- ADDITIVE ONLY, on inv_ objects:
--   * new tables: inv_count_settings, inv_stock_counts (append-only),
--     inv_month_snapshots2 + inv_closed_months2 (append-only);
--   * new functions, all with new names. inv_rollover, inv_record_transaction,
--     inv_record_entry, inv_reverse_entry, inv_page2, inv_range_report,
--     inv_product_history2 and every other existing function are NOT changed
--     and keep working;
--   * one new trigger on inv_transactions that refuses an entry taking a
--     balance below zero (counting stock counts too), so the over-issue rule
--     holds whichever function writes the entry.
--   No existing row is updated, deleted or backfilled.
--
-- THE ONE CHANGE TO THE CALCULATION
--   Balance = Opening + Adjustment + Receiving − Issue
--   * A stock count records the balance the store person counted. Its
--     adjustment = counted − the balance just before it (generated, stored).
--     The ledger stays append-only: a later count adds a new adjustment.
--   * From the month in inv_count_settings.counts_from (the month after this
--     migration is applied: December 2026 on live), every active product
--     that existed before the month starts the month "pending" until its
--     balance is counted. A product added during a month is confirmed when
--     it is added, as before. The first count of a pending product is dated
--     the first day of the month: it is the month-start balance.
--   * Months before counts_from are closed exactly as inv_rollover closes
--     them (into inv_month_snapshots / inv_closed_months, same SQL), so
--     November 2026 looks and calculates exactly as before. Months from
--     counts_from on are closed into inv_month_snapshots2 /
--     inv_closed_months2, which carry the adjustment.
-- ============================================================================

begin;

-- ── 1. tables ──────────────────────────────────────────────────────────────

-- From which month month-start counting applies. One row.
create table if not exists public.inv_count_settings (
  id          boolean primary key default true check (id),
  counts_from date not null check (counts_from = date_trunc('month', counts_from)::date),
  created_at  timestamptz not null default now()
);
insert into public.inv_count_settings (id, counts_from)
values (true, (date_trunc('month', public.inv_today()) + interval '1 month')::date)
on conflict (id) do nothing;

-- Stock counts: append-only, like inv_transactions.
create table if not exists public.inv_stock_counts (
  id              bigint generated always as identity primary key,
  product_id      uuid not null references public.inv_products(id),
  month           date not null check (month = date_trunc('month', month)::date),
  entry_date      date not null,
  counted         numeric(14,3) not null check (counted >= 0),
  balance_before  numeric(15,3) not null,
  -- signed effect on the balance
  adjustment      numeric(15,3) generated always as (counted - balance_before) stored,
  source          text not null default 'app' check (source in ('app', 'import')),
  note            text check (char_length(note) <= 300),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 120),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  check (month = date_trunc('month', entry_date)::date)
);
create index if not exists inv_stock_counts_product_month on public.inv_stock_counts (product_id, month, id desc);
create index if not exists inv_stock_counts_month on public.inv_stock_counts (month);

-- Closed months from counts_from on, with the adjustment.
create table if not exists public.inv_month_snapshots2 (
  product_id uuid not null references public.inv_products(id),
  month      date not null check (month = date_trunc('month', month)::date),
  opening    numeric(15,3) not null,
  adjustment numeric(15,3) not null,
  received   numeric(15,3) not null,
  issued     numeric(15,3) not null,
  closing    numeric(15,3) not null,
  -- the balance was counted that month (or the product was added in it)
  confirmed  boolean not null,
  created_at timestamptz not null default now(),
  primary key (product_id, month),
  check (closing = opening + adjustment + received - issued)
);
create index if not exists inv_month_snapshots2_month on public.inv_month_snapshots2 (month);

create table if not exists public.inv_closed_months2 (
  month     date primary key check (month = date_trunc('month', month)::date),
  products  int not null,
  closed_at timestamptz not null default now()
);

-- ── 2. nothing is ever deleted (the 0028 trigger function) ─────────────────
create or replace trigger inv_stock_counts_append_only
  before update or delete on public.inv_stock_counts for each row execute function public.inv_forbid_change();
create or replace trigger inv_month_snapshots2_append_only
  before update or delete on public.inv_month_snapshots2 for each row execute function public.inv_forbid_change();
create or replace trigger inv_closed_months2_append_only
  before update or delete on public.inv_closed_months2 for each row execute function public.inv_forbid_change();
create or replace trigger inv_count_settings_no_delete
  before delete on public.inv_count_settings for each row execute function public.inv_forbid_change();
create or replace trigger inv_stock_counts_no_truncate
  before truncate on public.inv_stock_counts for each statement execute function public.inv_forbid_change();
create or replace trigger inv_month_snapshots2_no_truncate
  before truncate on public.inv_month_snapshots2 for each statement execute function public.inv_forbid_change();
create or replace trigger inv_closed_months2_no_truncate
  before truncate on public.inv_closed_months2 for each statement execute function public.inv_forbid_change();
create or replace trigger inv_count_settings_no_truncate
  before truncate on public.inv_count_settings for each statement execute function public.inv_forbid_change();

-- ── 3. row-level security: read for inventory + admin tier, writes = RPCs ──
alter table public.inv_count_settings   enable row level security;
alter table public.inv_stock_counts     enable row level security;
alter table public.inv_month_snapshots2 enable row level security;
alter table public.inv_closed_months2   enable row level security;
do $$
declare t text;
begin
  foreach t in array array['inv_count_settings', 'inv_stock_counts', 'inv_month_snapshots2', 'inv_closed_months2'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                                              and policyname = t || '_read') then
      execute format('create policy %I on public.%I for select to authenticated '
                     'using ((select public.inv_can_view()))', t || '_read', t);
    end if;
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

-- ── 4. helpers ─────────────────────────────────────────────────────────────

-- The first month month-start counting applies ('infinity' = never).
create or replace function public.inv_counts_from()
returns date
language sql stable security definer set search_path = public as $$
  select coalesce((select counts_from from public.inv_count_settings where id), 'infinity'::date)
$$;

-- The balance now: opening + every entry + every stock count adjustment.
create or replace function public.inv_balance_now(p_product_id uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select p.opening_qty
       + coalesce((select sum(t.delta) from public.inv_transactions t where t.product_id = p.id), 0)
       + coalesce((select sum(c.adjustment) from public.inv_stock_counts c where c.product_id = p.id), 0)
    from public.inv_products p where p.id = p_product_id
$$;

-- Pending in a month: active, existed before the month, counting applies,
-- and no stock count yet in that month.
create or replace function public.inv_is_pending(p_product_id uuid, p_month date)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_active and p.opening_month < p_month and p_month >= public.inv_counts_from()
                          and not exists (select 1 from public.inv_stock_counts c
                                           where c.product_id = p.id and c.month = p_month)
                     from public.inv_products p where p.id = p_product_id), false)
$$;

-- The over-issue rule for every writer of inv_transactions: an entry that
-- would take the balance (stock counts included) below zero is refused.
-- (BEFORE INSERT: the generated `delta` isn't computed yet, so it's derived here.)
create or replace function public.inv_guard_negative_balance()
returns trigger
language plpgsql set search_path = public as $$
declare
  v_delta numeric := case when (new.kind = 'receive') = (new.reverses_id is null) then new.qty else -new.qty end;
begin
  if v_delta < 0 and public.inv_balance_now(new.product_id) + v_delta < 0 then
    raise exception 'not enough stock: the balance would go below zero' using errcode = '23514';
  end if;
  return new;
end $$;
create or replace trigger inv_transactions_no_negative
  before insert on public.inv_transactions for each row execute function public.inv_guard_negative_balance();

-- Write one stock count. Internal: the caller has checked the role, holds
-- the shared ledger lock and the product's row lock, and has checked that
-- the product is active. {status ok | invalid, ...}
create or replace function public.inv_put_count(
  p_product_id uuid, p_counted numeric, p_note text, p_key text, p_source text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_today  date := public.inv_today();
  v_month  date := date_trunc('month', public.inv_today())::date;
  v_from   date := public.inv_counts_from();
  v_before numeric;
  v_first  boolean;
  v_id     bigint;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_month < v_from then
    return jsonb_build_object('status', 'invalid',
      'message', 'Month-start balances begin on ' || to_char(v_from, 'FMDD FMMonth YYYY') || '.');
  end if;
  if p_counted is null or p_counted < 0 then
    return jsonb_build_object('status', 'invalid', 'message', 'Enter the balance: 0 or more.');
  end if;
  if p_counted <> round(p_counted, 3) then
    return jsonb_build_object('status', 'invalid', 'message', 'Use at most 3 decimal places.');
  end if;
  if p_counted >= 100000000000 then
    return jsonb_build_object('status', 'invalid', 'message', 'That balance is too large.');
  end if;
  if char_length(coalesce(v_note, '')) > 300 then
    return jsonb_build_object('status', 'invalid', 'message', 'The remark is longer than 300 characters.');
  end if;
  if p_key is null or char_length(p_key) not between 8 and 120 then
    return jsonb_build_object('status', 'invalid', 'message', 'Please try again.');
  end if;

  v_first := public.inv_is_pending(p_product_id, v_month);
  v_before := public.inv_balance_now(p_product_id);
  -- the first count of a pending product is the month-start balance: dated the 1st
  insert into public.inv_stock_counts (product_id, month, entry_date, counted, balance_before, source, note,
                                       idempotency_key, created_by)
  values (p_product_id, v_month, case when v_first then v_month else v_today end, p_counted, v_before,
          p_source, v_note, p_key, auth.uid())
  returning id into v_id;

  return jsonb_build_object('status', 'ok', 'count_id', v_id, 'month_start', v_first,
                            'balance_before', trim_scale(v_before)::text,
                            'balance_after', trim_scale(p_counted)::text,
                            'adjustment', trim_scale(p_counted - v_before)::text);
end $$;

-- ── 5. record a stock count (inventory only) ───────────────────────────────
-- Row-locks the product; the same idempotency key twice records once.
-- {status: ok | duplicate | invalid | not_found | archived, ...}
create or replace function public.inv_record_stock_count(
  p_product_id      uuid,
  p_counted         numeric,
  p_note            text,
  p_idempotency_key text
)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_p public.inv_products;
  v_c public.inv_stock_counts;
  v_r jsonb;
begin
  if not public.inv_can_manage() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 120 then
    return jsonb_build_object('status', 'invalid', 'message', 'Please try again.');
  end if;

  perform public.inv_ledger_lock(false);
  select * into v_p from public.inv_products where id = p_product_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'message', 'This product no longer exists.');
  end if;

  select * into v_c from public.inv_stock_counts where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('status', 'duplicate', 'count_id', v_c.id,
                              'balance_after', trim_scale(public.inv_balance_now(p_product_id))::text);
  end if;
  if not v_p.is_active then
    return jsonb_build_object('status', 'archived', 'message', 'This product is archived.');
  end if;

  v_r := public.inv_put_count(p_product_id, p_counted, p_note, p_idempotency_key, 'app');
  if v_r ->> 'status' = 'ok' then
    v_r := v_r || jsonb_build_object('min_stock', trim_scale(v_p.min_stock)::text,
                                     'below_min', v_p.min_stock is not null and p_counted < v_p.min_stock);
  end if;
  return v_r;
end $$;

-- ── 6. record an entry (new version) ───────────────────────────────────────
-- inv_record_entry (0030) with the balance counting stock counts, and one
-- more rule: a product pending this month takes no entry until its balance
-- is counted. p_count (+ p_count_key) counts it in the same transaction,
-- first, so "enter the balance, then receive / issue" is one atomic save.
create or replace function public.inv_record_entry2(
  p_product_id      uuid,
  p_kind            text,
  p_qty             numeric,
  p_entry_date      date,
  p_note            text,
  p_idempotency_key text,
  p_party           text default null,
  p_challan_no      text default null,
  p_bill_no         text default null,
  p_bill_date       date default null,
  p_job_no          text default null,
  p_rating          text default null,
  p_no_of_jobs      text default null,
  p_count           numeric default null,
  p_count_key       text default null
)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_today   date := public.inv_today();
  v_month   date := date_trunc('month', public.inv_today())::date;
  v_p       public.inv_products;
  v_tx      public.inv_transactions;
  v_before  numeric;
  v_after   numeric;
  v_id      bigint;
  v_count   jsonb;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_party   text := public.inv_clean_text(p_party);
  v_challan text := public.inv_clean_text(p_challan_no);
  v_bill    text := public.inv_clean_text(p_bill_no);
  v_job     text := public.inv_clean_text(p_job_no);
  v_rating  text := public.inv_clean_text(p_rating);
  v_jobs    text := public.inv_clean_text(p_no_of_jobs);
begin
  if not public.inv_can_manage() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 120 then
    return jsonb_build_object('status', 'invalid', 'message', 'Please try again.');
  end if;

  perform public.inv_ledger_lock(false);
  select * into v_p from public.inv_products where id = p_product_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'message', 'This product no longer exists.');
  end if;

  select * into v_tx from public.inv_transactions where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('status', 'duplicate', 'id', v_tx.id,
                              'balance_after', trim_scale(public.inv_balance_now(p_product_id))::text);
  end if;

  if not v_p.is_active then
    return jsonb_build_object('status', 'archived', 'message', 'This product is archived.');
  end if;
  if p_kind is null or p_kind not in ('receive', 'issue') then
    return jsonb_build_object('status', 'invalid', 'message', 'Choose Receive or Issue.');
  end if;
  if p_qty is null or p_qty <= 0 then
    return jsonb_build_object('status', 'invalid', 'message', 'Enter a quantity above 0.');
  end if;
  if p_qty <> round(p_qty, 3) then
    return jsonb_build_object('status', 'invalid', 'message', 'Use at most 3 decimal places.');
  end if;
  if p_qty >= 100000000000 then
    return jsonb_build_object('status', 'invalid', 'message', 'That quantity is too large.');
  end if;
  if p_entry_date is null or p_entry_date > v_today or p_entry_date < v_month then
    return jsonb_build_object('status', 'invalid',
                              'message', 'The date must be in the current month and not in the future.');
  end if;
  if char_length(coalesce(v_note, '')) > 300 then
    return jsonb_build_object('status', 'invalid', 'message', 'The remark is longer than 300 characters.');
  end if;
  if p_kind = 'receive' and (v_job is not null or v_rating is not null or v_jobs is not null) then
    return jsonb_build_object('status', 'invalid', 'message', 'Job No, Rating and No. of Jobs belong to an issue.');
  end if;
  if p_kind = 'issue' and (v_party is not null or v_challan is not null or v_bill is not null or p_bill_date is not null) then
    return jsonb_build_object('status', 'invalid', 'message', 'Party, Challan No, Bill No and Bill Date belong to a receipt.');
  end if;
  if char_length(coalesce(v_party, '')) > 120 then
    return jsonb_build_object('status', 'invalid', 'message', 'The party name is longer than 120 characters.');
  end if;
  if greatest(char_length(coalesce(v_challan, '')), char_length(coalesce(v_bill, '')),
              char_length(coalesce(v_job, '')), char_length(coalesce(v_rating, ''))) > 60 then
    return jsonb_build_object('status', 'invalid', 'message', 'Challan No, Bill No, Job No and Rating: at most 60 characters.');
  end if;
  if char_length(coalesce(v_jobs, '')) > 20 then
    return jsonb_build_object('status', 'invalid', 'message', 'No. of Jobs: at most 20 characters.');
  end if;
  if p_bill_date is not null and p_bill_date > v_today then
    return jsonb_build_object('status', 'invalid', 'message', 'The bill date can''t be in the future.');
  end if;

  -- pending this month: count first (same transaction), or refuse
  if public.inv_is_pending(p_product_id, v_month) then
    if p_count is null then
      return jsonb_build_object('status', 'pending', 'opening', trim_scale(public.inv_balance_now(p_product_id))::text,
                                'message', 'Enter this month''s balance first.');
    end if;
    -- nothing is written when the issue is larger than the counted balance
    if p_kind = 'issue' and p_count >= 0 and p_qty > p_count then
      return jsonb_build_object('status', 'insufficient', 'balance', trim_scale(p_count)::text,
                                'message', 'Not enough stock for this issue.');
    end if;
    v_count := public.inv_put_count(p_product_id, p_count, null, p_count_key, 'app');
    if v_count ->> 'status' <> 'ok' then
      return v_count;
    end if;
  end if;

  v_before := public.inv_balance_now(p_product_id);
  if p_kind = 'issue' and p_qty > v_before then
    return jsonb_build_object('status', 'insufficient', 'balance', trim_scale(v_before)::text,
                              'message', 'Not enough stock for this issue.');
  end if;

  insert into public.inv_transactions (product_id, kind, qty, entry_date, note, source, idempotency_key, created_by,
                                       party, party_key, challan_no, bill_no, bill_date, job_no, rating, no_of_jobs)
  values (p_product_id, p_kind, p_qty, p_entry_date, v_note, 'app', p_idempotency_key, auth.uid(),
          v_party, public.inv_party_key(v_party), v_challan, v_bill, p_bill_date, v_job, v_rating, v_jobs)
  returning id into v_id;

  v_after := v_before + case when p_kind = 'receive' then p_qty else -p_qty end;
  return jsonb_build_object('status', 'ok', 'id', v_id,
                            'balance_before', trim_scale(v_before)::text, 'balance_after', trim_scale(v_after)::text,
                            'min_stock', trim_scale(v_p.min_stock)::text,
                            'below_min', v_p.min_stock is not null and v_after < v_p.min_stock)
         || case when v_count is null then '{}'::jsonb
                 else jsonb_build_object('count_id', (v_count ->> 'count_id')::bigint,
                                         'adjustment', v_count ->> 'adjustment',
                                         'counted', v_count ->> 'balance_after') end;
end $$;

-- ── 7. reverse an entry (new version) ──────────────────────────────────────
-- inv_reverse_entry (0030) with the balance counting stock counts.
create or replace function public.inv_reverse_entry2(
  p_transaction_id  bigint,
  p_note            text,
  p_idempotency_key text
)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_today  date := public.inv_today();
  v_orig   public.inv_transactions;
  v_tx     public.inv_transactions;
  v_p      public.inv_products;
  v_before numeric;
  v_after  numeric;
  v_id     bigint;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.inv_can_manage() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 120 then
    return jsonb_build_object('status', 'invalid', 'message', 'Please try again.');
  end if;

  select * into v_orig from public.inv_transactions where id = p_transaction_id;
  if not found then
    return jsonb_build_object('status', 'not_found', 'message', 'This entry no longer exists.');
  end if;

  perform public.inv_ledger_lock(false);
  select * into v_p from public.inv_products where id = v_orig.product_id for update;

  select * into v_tx from public.inv_transactions where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('status', 'duplicate', 'id', v_tx.id,
                              'balance_after', trim_scale(public.inv_balance_now(v_p.id))::text);
  end if;

  if not v_p.is_active then
    return jsonb_build_object('status', 'archived', 'message', 'This product is archived.');
  end if;
  if v_orig.reverses_id is not null then
    return jsonb_build_object('status', 'invalid', 'message', 'A reversal cannot be reversed.');
  end if;
  if exists (select 1 from public.inv_transactions where reverses_id = v_orig.id) then
    return jsonb_build_object('status', 'invalid', 'message', 'This entry has already been reversed.');
  end if;
  if v_orig.entry_date < date_trunc('month', v_today)::date then
    return jsonb_build_object('status', 'invalid',
                              'message', 'Only entries from this month can be reversed. Record a new entry instead.');
  end if;
  if char_length(coalesce(v_note, '')) > 300 then
    return jsonb_build_object('status', 'invalid', 'message', 'The remark is longer than 300 characters.');
  end if;

  v_before := public.inv_balance_now(v_p.id);
  v_after  := v_before - v_orig.delta;
  if v_after < 0 then
    return jsonb_build_object('status', 'insufficient', 'balance', trim_scale(v_before)::text,
                              'message', 'Reversing this receipt would make the balance negative.');
  end if;

  insert into public.inv_transactions (product_id, kind, qty, entry_date, note, reverses_id, source,
                                       idempotency_key, created_by,
                                       party, party_key, challan_no, bill_no, bill_date, job_no, rating, no_of_jobs)
  values (v_p.id, v_orig.kind, v_orig.qty, v_today,
          coalesce(v_note, 'Reversal of entry #' || v_orig.id), v_orig.id, 'app',
          p_idempotency_key, auth.uid(),
          v_orig.party, v_orig.party_key, v_orig.challan_no, v_orig.bill_no, v_orig.bill_date,
          v_orig.job_no, v_orig.rating, v_orig.no_of_jobs)
  returning id into v_id;

  return jsonb_build_object('status', 'ok', 'id', v_id,
                            'balance_before', trim_scale(v_before)::text, 'balance_after', trim_scale(v_after)::text,
                            'min_stock', trim_scale(v_p.min_stock)::text,
                            'below_min', v_p.min_stock is not null and v_after < v_p.min_stock);
end $$;

-- ── 8. month rollover (new version) ────────────────────────────────────────
-- Closes every ended month that isn't closed yet, oldest first, in one
-- transaction under the exclusive ledger lock. Idempotent (a second run
-- closes nothing); handles a gap of several months. Months before
-- counts_from: exactly inv_rollover's SQL, into the 0028 tables. Months from
-- counts_from on: into inv_month_snapshots2 with the adjustment. Returns how
-- many months it closed. Nothing else is written: "pending" is derived
-- (no stock count yet this month), so a new month needs no rows.
create or replace function public.inv_rollover2()
returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  v_cur   date := date_trunc('month', public.inv_today())::date;
  v_from  date := public.inv_counts_from();
  v_first date := (select min(opening_month) from public.inv_products);
  v_end   date;
  v_m     date;
  v_n     int := 0;
  v_rows  int;
begin
  if not (public.inv_can_view() or public.inv_is_service()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if v_first is null then return 0; end if;
  v_end := least(v_cur, v_from); -- old-style months are those before v_end

  -- usually nothing to do: one indexed read per table
  if coalesce((select (max(month) + interval '1 month')::date from public.inv_closed_months), v_first) >= v_end
     and (v_from >= v_cur
          or coalesce((select (max(month) + interval '1 month')::date from public.inv_closed_months2),
                      greatest(v_from, v_first)) >= v_cur) then
    return 0;
  end if;

  perform public.inv_ledger_lock(true);

  -- (a) months before counts_from: the 0028 rollover, unchanged
  select (max(month) + interval '1 month')::date into v_m from public.inv_closed_months;
  v_m := coalesce(v_m, v_first);
  while v_m < v_end loop
    insert into public.inv_month_snapshots (product_id, month, opening, received, issued, closing)
    select p.id, v_m, o.opening, r.received, r.issued, o.opening + r.received - r.issued
      from public.inv_products p
      cross join lateral (
        select p.opening_qty + coalesce(sum(t.delta), 0) as opening
          from public.inv_transactions t
         where t.product_id = p.id and t.entry_date < v_m) o
      cross join lateral (
        select coalesce(sum(t.delta) filter (where t.kind = 'receive'), 0)    as received,
               coalesce(-(sum(t.delta) filter (where t.kind = 'issue')), 0) as issued
          from public.inv_transactions t
         where t.product_id = p.id
           and t.entry_date >= v_m and t.entry_date < (v_m + interval '1 month')::date) r
     where p.opening_month <= v_m
    on conflict (product_id, month) do nothing;
    get diagnostics v_rows = row_count;
    insert into public.inv_closed_months (month, products) values (v_m, v_rows)
    on conflict (month) do nothing;
    v_n := v_n + 1;
    v_m := (v_m + interval '1 month')::date;
  end loop;

  -- (b) months from counts_from on: with the stock count adjustment
  if v_from < v_cur then
    select (max(month) + interval '1 month')::date into v_m from public.inv_closed_months2;
    v_m := coalesce(v_m, greatest(v_from, v_first));
    while v_m < v_cur loop
      insert into public.inv_month_snapshots2 (product_id, month, opening, adjustment, received, issued, closing, confirmed)
      select p.id, v_m, o.opening, c.adjustment, r.received, r.issued,
             o.opening + c.adjustment + r.received - r.issued,
             p.opening_month >= v_m or c.counts > 0
        from public.inv_products p
        cross join lateral (
          select p.opening_qty
               + coalesce((select sum(t.delta) from public.inv_transactions t
                            where t.product_id = p.id and t.entry_date < v_m), 0)
               + coalesce((select sum(k.adjustment) from public.inv_stock_counts k
                            where k.product_id = p.id and k.entry_date < v_m), 0) as opening) o
        cross join lateral (
          select coalesce(sum(t.delta) filter (where t.kind = 'receive'), 0)    as received,
                 coalesce(-(sum(t.delta) filter (where t.kind = 'issue')), 0) as issued
            from public.inv_transactions t
           where t.product_id = p.id
             and t.entry_date >= v_m and t.entry_date < (v_m + interval '1 month')::date) r
        cross join lateral (
          select coalesce(sum(k.adjustment), 0) as adjustment, count(*) as counts
            from public.inv_stock_counts k
           where k.product_id = p.id and k.month = v_m) c
       where p.opening_month <= v_m
      on conflict (product_id, month) do nothing;
      get diagnostics v_rows = row_count;
      insert into public.inv_closed_months2 (month, products) values (v_m, v_rows)
      on conflict (month) do nothing;
      v_n := v_n + 1;
      v_m := (v_m + interval '1 month')::date;
    end loop;
  end if;
  return v_n;
end $$;

-- ── 9. reads (SECURITY INVOKER: RLS applies) ───────────────────────────────

-- Closed months that can be viewed, newest first: the 0028 ones before
-- counts_from, then the 0031 ones.
create or replace function public.inv_viewable_months()
returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(m order by m desc), '[]'::jsonb) from (
    select month as m from public.inv_closed_months where month < public.inv_counts_from()
    union
    select month from public.inv_closed_months2) z
$$;

-- Every product with its live figures for the current month (p_cur):
-- opening (before the month, stock counts included), the month's
-- adjustment, received, issued, the balance, and whether it is pending.
-- SECURITY INVOKER: RLS applies, so only the viewing roles get rows.
create or replace function public.inv_live_figures(p_cur date)
returns table (id uuid, serial_no text, description text, specification text, rate numeric, custom jsonb,
               is_active boolean, min_stock numeric, opening numeric, adjustment numeric, received numeric,
               issued numeric, balance numeric, pending boolean)
language sql stable security invoker set search_path = public as $$
  select p.id, p.serial_no, p.description, p.specification, p.rate, p.custom, p.is_active, p.min_stock,
         p.opening_qty + x.before + k.before, k.adj, x.received, x.issued,
         p.opening_qty + x.before + k.before + k.adj + x.received - x.issued,
         p.is_active and p.opening_month < p_cur and p_cur >= public.inv_counts_from() and k.counted = 0
    from public.inv_products p
    left join lateral (
      select coalesce(sum(t.delta) filter (where t.entry_date < p_cur), 0) as before,
             coalesce(sum(t.delta) filter (where t.entry_date >= p_cur and t.kind = 'receive'), 0) as received,
             coalesce(-(sum(t.delta) filter (where t.entry_date >= p_cur and t.kind = 'issue')), 0) as issued
        from public.inv_transactions t
       where t.product_id = p.id) x on true
    left join lateral (
      select coalesce(sum(c.adjustment) filter (where c.entry_date < p_cur), 0) as before,
             coalesce(sum(c.adjustment) filter (where c.entry_date >= p_cur), 0) as adj,
             count(*) filter (where c.month = p_cur) as counted
        from public.inv_stock_counts c
       where c.product_id = p.id) k on true
$$;

-- The main page in one pass: inv_page2 (0030) with the adjustment and the
-- month's pending state on every row, plus the counts beside the totals.
-- Rows end with two more fields: adjustment, pending. Closes ended months
-- first (inv_rollover2). Pending products count in no low-stock alert:
-- their balance isn't known yet.
create or replace function public.inv_page3(p_month date default null, p_analytics boolean default false)
returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_today date := public.inv_today();
  v_cur   date := date_trunc('month', public.inv_today())::date;
  v_month date := date_trunc('month', coalesce(p_month, public.inv_today()))::date;
  v_from  date;
  v_past  boolean;
  v_stats boolean;
  v_rows  jsonb;
  v_low   int;
  v_act   int;
  v_pend  int;
begin
  if not public.inv_can_view() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  v_stats := coalesce(p_analytics, false) and public.current_role_name()::text in ('head_admin', 'admin');
  perform public.inv_rollover2();
  v_from := public.inv_counts_from();

  v_past := v_month < v_cur and (
    (v_month < v_from and exists (select 1 from public.inv_closed_months where month = v_month))
    or exists (select 1 from public.inv_closed_months2 where month = v_month));
  if not v_past then v_month := v_cur; end if;

  if v_past then
    select coalesce(jsonb_agg(jsonb_build_array(
             p.id, p.serial_no, p.description, p.specification, trim_scale(p.rate)::text, p.custom, p.is_active,
             trim_scale(s.opening)::text, trim_scale(s.received)::text, trim_scale(s.issued)::text, trim_scale(s.closing)::text,
             trim_scale(p.min_stock)::text, lr.party, lr.entry_date, trim_scale(s.adjustment)::text, not s.confirmed)
           order by p.serial_no), '[]'::jsonb)
      into v_rows
      from (select product_id, opening, 0::numeric as adjustment, received, issued, closing, true as confirmed
              from public.inv_month_snapshots where month = v_month and v_month < v_from
            union all
            select product_id, opening, adjustment, received, issued, closing, confirmed
              from public.inv_month_snapshots2 where month = v_month) s
      join public.inv_products p on p.id = s.product_id
      left join lateral (
        select t.party, t.entry_date from public.inv_transactions t
         where p.min_stock is not null
           and t.product_id = p.id and t.kind = 'receive' and t.reverses_id is null
           and not exists (select 1 from public.inv_transactions r where r.reverses_id = t.id)
         order by t.id desc limit 1) lr on true;
    -- the alert and the counts always follow the live state, whatever month is viewed
    select count(*) filter (where f.is_active and not f.pending and f.min_stock is not null and f.balance < f.min_stock),
           count(*) filter (where f.is_active),
           count(*) filter (where f.pending)
      into v_low, v_act, v_pend
      from public.inv_live_figures(v_cur) f;
  else
    select coalesce(jsonb_agg(jsonb_build_array(
             f.id, f.serial_no, f.description, f.specification, trim_scale(f.rate)::text, f.custom, f.is_active,
             trim_scale(f.opening)::text, trim_scale(f.received)::text, trim_scale(f.issued)::text, trim_scale(f.balance)::text,
             trim_scale(f.min_stock)::text, lr.party, lr.entry_date, trim_scale(f.adjustment)::text, f.pending)
           order by f.serial_no), '[]'::jsonb),
           count(*) filter (where f.is_active and not f.pending and f.min_stock is not null and f.balance < f.min_stock),
           count(*) filter (where f.is_active),
           count(*) filter (where f.pending)
      into v_rows, v_low, v_act, v_pend
      from public.inv_live_figures(v_cur) f
      left join lateral (
        select t.party, t.entry_date from public.inv_transactions t
         where f.min_stock is not null -- only the Low Stock list uses it: no lookup otherwise
           and t.product_id = f.id and t.kind = 'receive' and t.reverses_id is null
           and not exists (select 1 from public.inv_transactions r where r.reverses_id = t.id)
         order by t.id desc limit 1) lr on true;
  end if;

  return jsonb_build_object(
    'today', v_today,
    'current_month', v_cur,
    'month', v_month,
    'is_current', not v_past,
    'counts_from', v_from,
    'ledger_seq', (select coalesce(max(id), 0) from public.inv_transactions),
    'count_seq', (select coalesce(max(id), 0) from public.inv_stock_counts),
    'columns', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', c.id, 'key', c.key, 'label', c.label, 'data_type', c.data_type,
                  'position', c.position, 'is_default', c.is_default, 'visible', c.visible,
                  'archived', c.archived_at is not null)
                order by c.is_default desc, c.position), '[]'::jsonb)
                from public.inv_columns c),
    'settings', (select jsonb_build_object('person_name', s.person_name, 'phone', s.phone)
                   from public.inv_settings s where s.id),
    'months', public.inv_viewable_months(),
    'fields', jsonb_build_array('id', 'serial_no', 'description', 'specification', 'rate', 'custom', 'is_active',
                                'opening', 'received', 'issued', 'balance', 'min_stock', 'last_party', 'last_received',
                                'adjustment', 'pending'),
    'rows', v_rows,
    'low_count', v_low,
    'active_count', v_act,
    'pending_count', v_pend,
    'parties', (select coalesce(jsonb_agg(z.party order by z.party), '[]'::jsonb) from (
                  select distinct on (t.party_key) t.party
                    from public.inv_transactions t
                   where t.party_key is not null
                   order by t.party_key, t.id desc) z),
    'trend', case when v_stats then (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'month', z.m, 'received', trim_scale(z.received)::text, 'issued', trim_scale(z.issued)::text)
                      order by z.m), '[]'::jsonb)
                 from (select g.m::date as m,
                              coalesce(sum(t.delta) filter (where t.kind = 'receive'), 0) as received,
                              coalesce(-(sum(t.delta) filter (where t.kind = 'issue')), 0) as issued
                         from generate_series((v_month - interval '5 months')::date, v_month, interval '1 month') g(m)
                         left join public.inv_transactions t
                           on t.entry_date >= g.m::date and t.entry_date < (g.m + interval '1 month')::date
                        group by g.m) z
             ) end,
    'top_issued', case when v_stats then (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'id', q.id, 'serial_no', q.serial_no, 'description', q.description,
                        'specification', q.specification, 'issued', trim_scale(q.issued)::text)
                      order by q.issued desc, q.serial_no), '[]'::jsonb)
                 from (select p.id, p.serial_no, p.description, p.specification, -sum(t.delta) as issued
                         from public.inv_transactions t
                         join public.inv_products p on p.id = t.product_id
                        where t.kind = 'issue' and t.entry_date >= v_month
                          and t.entry_date < (v_month + interval '1 month')::date
                        group by p.id
                       having -sum(t.delta) > 0
                        order by issued desc, p.serial_no
                        limit 10) q
             ) end
  );
end $$;

-- Figures for any date range (the exports): inv_range_report (0028) with
-- the stock count adjustment. Opening = balance before p_from; Adjustment,
-- Received, Issued = sums inside [p_from, p_to]; Closing = balance at the
-- end of p_to, so Opening + Adjustment + Received − Issued = Closing on
-- every row. `pending` = pending in the current month, set when the range
-- reaches into it.
create or replace function public.inv_range_report2(p_from date, p_to date)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_cur  date := date_trunc('month', public.inv_today())::date;
  v_from date := public.inv_counts_from();
begin
  if not public.inv_can_view() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_from is null then
    p_from := least(coalesce((select min(opening_month) from public.inv_products), v_cur), p_to);
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'current_month', v_cur,
    'columns', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', c.id, 'key', c.key, 'label', c.label, 'data_type', c.data_type,
                  'position', c.position, 'is_default', c.is_default, 'visible', c.visible,
                  'archived', c.archived_at is not null)
                order by c.is_default desc, c.position), '[]'::jsonb)
                from public.inv_columns c),
    'settings', (select jsonb_build_object('person_name', s.person_name, 'phone', s.phone)
                   from public.inv_settings s where s.id),
    'products', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', p.id, 'serial_no', p.serial_no, 'description', p.description,
                   'specification', p.specification, 'rate', p.rate::text, 'custom', p.custom,
                   'is_active', p.is_active,
                   'opening', (p.opening_qty + x.before + k.before)::text,
                   'adjustment', k.adj::text,
                   'received', x.received::text, 'issued', x.issued::text,
                   'balance', (p.opening_qty + x.before + k.before + k.adj + x.received - x.issued)::text,
                   'pending', p_to >= v_cur and p.is_active and p.opening_month < v_cur and v_cur >= v_from
                              and not exists (select 1 from public.inv_stock_counts c
                                               where c.product_id = p.id and c.month = v_cur))
                 order by p.serial_no), '[]'::jsonb)
                 from public.inv_products p
                 cross join lateral (
                   select coalesce(sum(t.delta) filter (where t.entry_date < p_from), 0) as before,
                          coalesce(sum(t.delta) filter (where t.entry_date between p_from and p_to
                                                          and t.kind = 'receive'), 0) as received,
                          coalesce(-(sum(t.delta) filter (where t.entry_date between p_from and p_to
                                                             and t.kind = 'issue')), 0) as issued,
                          count(*) filter (where t.entry_date between p_from and p_to) as moves
                     from public.inv_transactions t
                    where t.product_id = p.id) x
                 cross join lateral (
                   select coalesce(sum(c.adjustment) filter (where c.entry_date < p_from), 0) as before,
                          coalesce(sum(c.adjustment) filter (where c.entry_date between p_from and p_to), 0) as adj,
                          count(*) filter (where c.entry_date between p_from and p_to) as moves
                     from public.inv_stock_counts c
                    where c.product_id = p.id) k
                where p.opening_month <= p_to and (p.is_active or x.moves > 0 or k.moves > 0))
  );
end $$;

-- inv_product_history2 (0030) plus the product's stock counts and its
-- closed months from both snapshot tables (with the adjustment).
create or replace function public.inv_product_history3(p_product_id uuid, p_limit int default 25)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v jsonb;
  v_from date := public.inv_counts_from();
begin
  v := public.inv_product_history2(p_product_id, p_limit); -- checks the role
  return v || jsonb_build_object(
    'counts', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', c.id, 'month', c.month, 'entry_date', c.entry_date,
                 'counted', trim_scale(c.counted)::text, 'balance_before', trim_scale(c.balance_before)::text,
                 'adjustment', trim_scale(c.adjustment)::text, 'source', c.source, 'note', c.note,
                 'created_at', c.created_at, 'by', public.inv_actor_name(c.created_by)) order by c.id desc), '[]'::jsonb)
                 from (select * from public.inv_stock_counts where product_id = p_product_id
                        order by id desc limit greatest(1, least(coalesce(p_limit, 25), 200))) c),
    'months', (select coalesce(jsonb_agg(jsonb_build_object(
                 'month', s.month, 'opening', trim_scale(s.opening)::text, 'adjustment', trim_scale(s.adjustment)::text,
                 'received', trim_scale(s.received)::text, 'issued', trim_scale(s.issued)::text,
                 'closing', trim_scale(s.closing)::text, 'confirmed', s.confirmed) order by s.month desc), '[]'::jsonb)
                 from (select * from (
                         select month, opening, 0::numeric as adjustment, received, issued, closing, true as confirmed
                           from public.inv_month_snapshots where product_id = p_product_id and month < v_from
                         union all
                         select month, opening, adjustment, received, issued, closing, confirmed
                           from public.inv_month_snapshots2 where product_id = p_product_id) u
                        order by month desc limit 12) s));
end $$;

-- ── 10. who may call what ──────────────────────────────────────────────────
do $$
declare f text;
begin
  -- signed-in accounts (each function checks the role itself)
  foreach f in array array[
    'inv_counts_from()', 'inv_rollover2()', 'inv_viewable_months()',
    'inv_record_stock_count(uuid, numeric, text, text)',
    'inv_record_entry2(uuid, text, numeric, date, text, text, text, text, text, date, text, text, text, numeric, text)',
    'inv_reverse_entry2(bigint, text, text)',
    'inv_live_figures(date)', 'inv_page3(date, boolean)', 'inv_range_report2(date, date)',
    'inv_product_history3(uuid, int)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  -- internal helpers: nobody calls them over the API
  foreach f in array array[
    'inv_balance_now(uuid)', 'inv_is_pending(uuid, date)', 'inv_guard_negative_balance()',
    'inv_put_count(uuid, numeric, text, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

commit;
