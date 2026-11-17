-- ============================================================================
-- NR Industries — 0030_inventory_fields.sql
--
-- Receive / issue details, a minimum-stock alert and Party search for the
-- Inventory module. ADDITIVE ONLY, on inv_ objects:
--   * new NULLABLE columns (ADD COLUMN IF NOT EXISTS): no existing row is
--     updated or backfilled; old ledger entries simply have no details;
--   * a new partial index;
--   * NEW functions. inv_record_transaction, inv_reverse_transaction,
--     inv_add_product, inv_update_product, inv_page, inv_product_history
--     are NOT changed and keep working exactly as before.
-- The rules are the same: Balance = Opening + Receiving − Issue, append-only
-- ledger, over-issue refused, month rollover unchanged.
-- ============================================================================

begin;

-- ── 1. columns ─────────────────────────────────────────────────────────────
alter table public.inv_transactions
  add column if not exists party      text check (char_length(party) <= 120),
  add column if not exists party_key  text check (char_length(party_key) <= 120),
  add column if not exists challan_no text check (char_length(challan_no) <= 60),
  add column if not exists bill_no    text check (char_length(bill_no) <= 60),
  add column if not exists bill_date  date,
  add column if not exists job_no     text check (char_length(job_no) <= 60),
  add column if not exists rating     text check (char_length(rating) <= 60),
  add column if not exists no_of_jobs text check (char_length(no_of_jobs) <= 20);

alter table public.inv_products
  add column if not exists min_stock numeric(14,3) check (min_stock >= 0);

-- Party search and the party list
create index if not exists inv_transactions_party_key
  on public.inv_transactions (party_key, product_id) where party_key is not null;

-- ── 2. helpers ─────────────────────────────────────────────────────────────

-- "  Shree  Traders " -> "shree traders": how party names are matched
create or replace function public.inv_party_key(p text)
returns text
language sql immutable set search_path = public as $$
  select nullif(lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')), '')
$$;

-- trimmed, inner spaces collapsed, empty -> null
create or replace function public.inv_clean_text(p text)
returns text
language sql immutable set search_path = public as $$
  select nullif(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'), '')
$$;

-- ── 3. record an entry, with its details (new version) ────────────────────
-- The same as inv_record_transaction (row lock, idempotency key, refusal of
-- an issue larger than the balance, current-month date), plus the details.
-- Receive-only details (party, challan, bill no, bill date) are refused on
-- an issue and issue-only ones (job no, rating, no. of jobs) on a receipt.
create or replace function public.inv_record_entry(
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
  p_no_of_jobs      text default null
)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_today   date := public.inv_today();
  v_p       public.inv_products;
  v_tx      public.inv_transactions;
  v_before  numeric;
  v_after   numeric;
  v_id      bigint;
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
                              'balance_after', public.inv_balance_of(p_product_id)::text);
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
  if p_entry_date is null or p_entry_date > v_today
     or p_entry_date < date_trunc('month', v_today)::date then
    return jsonb_build_object('status', 'invalid',
                              'message', 'The date must be in the current month and not in the future.');
  end if;
  if char_length(coalesce(v_note, '')) > 300 then
    return jsonb_build_object('status', 'invalid', 'message', 'The remark is longer than 300 characters.');
  end if;

  -- details: the right ones for the kind, each within its length
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

  v_before := public.inv_balance_of(p_product_id);
  if p_kind = 'issue' and p_qty > v_before then
    return jsonb_build_object('status', 'insufficient', 'balance', v_before::text,
                              'message', 'Not enough stock for this issue.');
  end if;

  insert into public.inv_transactions (product_id, kind, qty, entry_date, note, source, idempotency_key, created_by,
                                       party, party_key, challan_no, bill_no, bill_date, job_no, rating, no_of_jobs)
  values (p_product_id, p_kind, p_qty, p_entry_date, v_note, 'app', p_idempotency_key, auth.uid(),
          v_party, public.inv_party_key(v_party), v_challan, v_bill, p_bill_date, v_job, v_rating, v_jobs)
  returning id into v_id;

  v_after := v_before + case when p_kind = 'receive' then p_qty else -p_qty end;
  return jsonb_build_object('status', 'ok', 'id', v_id,
                            'balance_before', v_before::text, 'balance_after', v_after::text,
                            'min_stock', v_p.min_stock::text,
                            'below_min', v_p.min_stock is not null and v_after < v_p.min_stock);
end $$;

-- ── 4. reverse an entry, copying its details (new version) ────────────────
-- The same rules as inv_reverse_transaction; the new entry carries the
-- original's party, challan, bill, job, rating and no. of jobs.
create or replace function public.inv_reverse_entry(
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
                              'balance_after', public.inv_balance_of(v_p.id)::text);
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

  v_before := public.inv_balance_of(v_p.id);
  v_after  := v_before - v_orig.delta;
  if v_after < 0 then
    return jsonb_build_object('status', 'insufficient', 'balance', v_before::text,
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
                            'balance_before', v_before::text, 'balance_after', v_after::text,
                            'min_stock', v_p.min_stock::text,
                            'below_min', v_p.min_stock is not null and v_after < v_p.min_stock);
end $$;

-- ── 5. minimum stock (inventory only) ──────────────────────────────────────

-- Set (or clear, with null) one product's minimum stock. Logged.
create or replace function public.inv_set_min_stock(p_product_id uuid, p_min_stock numeric)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_old public.inv_products;
begin
  if not public.inv_can_manage() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_min_stock is not null and (p_min_stock < 0 or p_min_stock <> round(p_min_stock, 3) or p_min_stock >= 100000000000) then
    return jsonb_build_object('status', 'invalid', 'message', 'The minimum must be 0 or more, with at most 3 decimals.');
  end if;
  select * into v_old from public.inv_products where id = p_product_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'message', 'This product no longer exists.');
  end if;
  if v_old.min_stock is not distinct from p_min_stock then
    return jsonb_build_object('status', 'ok', 'changed', false);
  end if;
  update public.inv_products set min_stock = p_min_stock where id = p_product_id;
  insert into public.inv_product_log (product_id, action, before, after, actor)
  values (p_product_id, 'update', jsonb_build_object('min_stock', v_old.min_stock::text),
          jsonb_build_object('min_stock', p_min_stock::text), auth.uid());
  return jsonb_build_object('status', 'ok', 'changed', true);
end $$;

-- The same minimum for several products at once (the settings' "set for
-- all filtered"). Atomic. Returns how many changed.
create or replace function public.inv_set_min_stock_bulk(p_product_ids uuid[], p_min_stock numeric)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_n int := 0;
  r   record;
begin
  if not public.inv_can_manage() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_product_ids is null or coalesce(array_length(p_product_ids, 1), 0) = 0 then
    return jsonb_build_object('status', 'invalid', 'message', 'No products chosen.');
  end if;
  if array_length(p_product_ids, 1) > 10000 then
    return jsonb_build_object('status', 'invalid', 'message', 'Too many products at once.');
  end if;
  if p_min_stock is not null and (p_min_stock < 0 or p_min_stock <> round(p_min_stock, 3) or p_min_stock >= 100000000000) then
    return jsonb_build_object('status', 'invalid', 'message', 'The minimum must be 0 or more, with at most 3 decimals.');
  end if;
  for r in select id, min_stock from public.inv_products
            where id = any(p_product_ids) and min_stock is distinct from p_min_stock
            order by id for update loop
    update public.inv_products set min_stock = p_min_stock where id = r.id;
    insert into public.inv_product_log (product_id, action, before, after, actor)
    values (r.id, 'update', jsonb_build_object('min_stock', r.min_stock::text),
            jsonb_build_object('min_stock', p_min_stock::text), auth.uid());
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('status', 'ok', 'changed', v_n);
end $$;

-- Add a product with a minimum: the existing inv_add_product, then the
-- minimum, in one transaction (nothing is added if either part refuses).
create or replace function public.inv_add_product_v2(
  p_serial_no     text,
  p_description   text,
  p_specification text,
  p_rate          numeric,
  p_opening_qty   numeric,
  p_custom        jsonb,
  p_min_stock     numeric
)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_r jsonb;
begin
  if not public.inv_can_manage() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_min_stock is not null and (p_min_stock < 0 or p_min_stock <> round(p_min_stock, 3) or p_min_stock >= 100000000000) then
    return jsonb_build_object('status', 'invalid', 'message', 'The minimum must be 0 or more, with at most 3 decimals.');
  end if;
  v_r := public.inv_add_product(p_serial_no, p_description, p_specification, p_rate, p_opening_qty, p_custom);
  if v_r ->> 'status' <> 'ok' or p_min_stock is null then
    return v_r;
  end if;
  update public.inv_products set min_stock = p_min_stock where id = (v_r ->> 'id')::uuid;
  return v_r;
end $$;

-- Edit details with a minimum: the existing inv_update_product, then the
-- minimum (p_min_stock null = no minimum), in one transaction.
create or replace function public.inv_update_product_v2(
  p_product_id    uuid,
  p_description   text,
  p_specification text,
  p_rate          numeric,
  p_custom        jsonb,
  p_min_stock     numeric
)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_r jsonb;
  v_m jsonb;
begin
  if not public.inv_can_manage() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_min_stock is not null and (p_min_stock < 0 or p_min_stock <> round(p_min_stock, 3) or p_min_stock >= 100000000000) then
    return jsonb_build_object('status', 'invalid', 'message', 'The minimum must be 0 or more, with at most 3 decimals.');
  end if;
  v_r := public.inv_update_product(p_product_id, p_description, p_specification, p_rate, p_custom);
  if v_r ->> 'status' <> 'ok' then
    return v_r;
  end if;
  v_m := public.inv_set_min_stock(p_product_id, p_min_stock);
  if v_m ->> 'status' <> 'ok' then
    raise exception '%', v_m ->> 'message' using errcode = '22023'; -- undo the edit too
  end if;
  return v_r;
end $$;

-- ── 6. reads (SECURITY INVOKER: RLS applies) ───────────────────────────────

-- inv_page (0029) plus, per product: minimum stock, the last receipt's party
-- and date; plus the low-stock count and the known party names.
create or replace function public.inv_page2(p_month date default null, p_analytics boolean default false)
returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_page  jsonb;
  v_extra jsonb;
  v_cur   date := date_trunc('month', public.inv_today())::date;
begin
  v_page := public.inv_page(p_month, p_analytics); -- checks the role, closes ended months
  -- extras by product id
  select coalesce(jsonb_object_agg(p.id::text, jsonb_build_array(trim_scale(p.min_stock)::text, lr.party, lr.entry_date)), '{}'::jsonb)
    into v_extra
    from public.inv_products p
    left join lateral (
      select t.party, t.entry_date from public.inv_transactions t
       where t.product_id = p.id and t.kind = 'receive' and t.reverses_id is null
         and not exists (select 1 from public.inv_transactions r where r.reverses_id = t.id)
       order by t.id desc limit 1) lr on true
   where (v_page ->> 'is_current')::boolean
      or exists (select 1 from public.inv_month_snapshots s where s.product_id = p.id and s.month = (v_page ->> 'month')::date);
  return v_page || jsonb_build_object(
    'extra_fields', jsonb_build_array('min_stock', 'last_party', 'last_received'),
    'extra', v_extra,
    'low_count', (select count(*) from public.inv_products p
                   where p.is_active and p.min_stock is not null
                     and p.opening_qty + coalesce((select sum(t.delta) from public.inv_transactions t where t.product_id = p.id), 0) < p.min_stock),
    'parties', (select coalesce(jsonb_agg(z.party order by z.party), '[]'::jsonb) from (
                  select distinct on (t.party_key) t.party
                    from public.inv_transactions t
                   where t.party_key is not null
                   order by t.party_key, t.id desc) z)
  );
end $$;

-- Party search: per product and party (all months), the net quantity
-- received from it and its last challan, bill no, bill date and date.
create or replace function public.inv_party_index()
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.inv_can_view() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'fields', jsonb_build_array('product_id', 'party_key', 'party', 'qty', 'challan_no', 'bill_no', 'bill_date', 'last_date'),
    'rows', (select coalesce(jsonb_agg(jsonb_build_array(z.product_id, z.party_key, z.party, trim_scale(z.qty)::text,
                                                          z.challan_no, z.bill_no, z.bill_date, z.last_date)), '[]'::jsonb)
               from (select t.product_id, t.party_key,
                            (array_agg(t.party order by t.id desc))[1] as party,
                            sum(t.delta) as qty,
                            -- "last" = the newest receipt that still stands (not a reversal, not reversed)
                            (array_agg(t.challan_no order by t.id desc) filter (where t.challan_no is not null and t.reverses_id is null and rv.id is null))[1] as challan_no,
                            (array_agg(t.bill_no order by t.id desc) filter (where t.bill_no is not null and t.reverses_id is null and rv.id is null))[1] as bill_no,
                            (array_agg(t.bill_date order by t.id desc) filter (where t.bill_date is not null and t.reverses_id is null and rv.id is null))[1] as bill_date,
                            max(t.entry_date) filter (where t.reverses_id is null and rv.id is null) as last_date
                       from public.inv_transactions t
                       left join public.inv_transactions rv on rv.reverses_id = t.id
                      where t.party_key is not null and t.kind = 'receive'
                      group by t.product_id, t.party_key) z)
  );
end $$;

-- inv_product_history plus each entry's details.
create or replace function public.inv_product_history2(p_product_id uuid, p_limit int default 25)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v jsonb;
begin
  v := public.inv_product_history(p_product_id, p_limit); -- checks the role
  return v || jsonb_build_object('details', (
    select coalesce(jsonb_object_agg(t.id::text, jsonb_strip_nulls(jsonb_build_object(
             'party', t.party, 'challan_no', t.challan_no, 'bill_no', t.bill_no, 'bill_date', t.bill_date,
             'job_no', t.job_no, 'rating', t.rating, 'no_of_jobs', t.no_of_jobs))), '{}'::jsonb)
      from public.inv_transactions t
     where t.product_id = p_product_id
       and t.id in (select (e ->> 'id')::bigint from jsonb_array_elements(v -> 'entries') e)
       and (t.party is not null or t.challan_no is not null or t.bill_no is not null or t.bill_date is not null
            or t.job_no is not null or t.rating is not null or t.no_of_jobs is not null)));
end $$;

-- ── 7. who may call what ───────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'inv_record_entry(uuid, text, numeric, date, text, text, text, text, text, date, text, text, text)',
    'inv_reverse_entry(bigint, text, text)',
    'inv_set_min_stock(uuid, numeric)', 'inv_set_min_stock_bulk(uuid[], numeric)',
    'inv_add_product_v2(text, text, text, numeric, numeric, jsonb, numeric)',
    'inv_update_product_v2(uuid, text, text, numeric, jsonb, numeric)',
    'inv_page2(date, boolean)', 'inv_party_index()', 'inv_product_history2(uuid, int)',
    'inv_party_key(text)', 'inv_clean_text(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

commit;
