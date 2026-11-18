-- ============================================================================
-- NR Industries — 0033_inventory_import.sql
--
-- "Import from document": applying a product list read in the browser. The
-- document itself never reaches the server: the page reads it in memory and
-- sends only the resulting rows. This migration stores only those rows'
-- effects (stock counts, new products, filled blanks, archived products)
-- and one import-run record with the time, the user and counts. No file
-- name and no file content are stored anywhere.
--
-- ADDITIVE ONLY:
--   * new table inv_import_runs (append-only);
--   * a new NULLABLE column inv_stock_counts.import_run_id (the 0031 table;
--     no existing row is updated);
--   * new functions inv_import_apply (+ an internal key helper).
-- Every existing function is unchanged.
-- ============================================================================

begin;

create table if not exists public.inv_import_runs (
  id           bigint generated always as identity primary key,
  batch_key    text not null unique check (char_length(batch_key) between 8 and 120),
  rows_in_file int not null default 0 check (rows_in_file >= 0),
  counted      int not null default 0,  -- stock counts written (matched products)
  adjusted     int not null default 0,  -- of which with a non-zero adjustment
  added        int not null default 0,  -- new products
  filled       int not null default 0,  -- products whose empty rate / specification was filled
  archived     int not null default 0,  -- products not in the file, archived on request
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index if not exists inv_import_runs_by on public.inv_import_runs (created_by, created_at);

create or replace trigger inv_import_runs_append_only
  before update or delete on public.inv_import_runs for each row execute function public.inv_forbid_change();
create or replace trigger inv_import_runs_no_truncate
  before truncate on public.inv_import_runs for each statement execute function public.inv_forbid_change();

alter table public.inv_import_runs enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inv_import_runs'
                                            and policyname = 'inv_import_runs_read') then
    create policy inv_import_runs_read on public.inv_import_runs for select to authenticated
      using ((select public.inv_can_view()));
  end if;
end $$;
revoke all on table public.inv_import_runs from anon, authenticated;
grant select on table public.inv_import_runs to authenticated;

-- which import wrote a stock count (null = typed in the app)
alter table public.inv_stock_counts add column if not exists import_run_id bigint references public.inv_import_runs(id);

-- How serials are compared everywhere in the import: trimmed, no spaces, upper case.
create or replace function public.inv_serial_key(p text)
returns text
language sql immutable set search_path = public as $$
  select upper(regexp_replace(coalesce(p, ''), '\s', '', 'g'))
$$;

-- ── apply an import (inventory only) ───────────────────────────────────────
-- One transaction. Idempotent on p_batch_key (a second call returns the
-- first one's result: a double tap or a retried request applies once).
-- Everything is checked again against the data as it is NOW, before
-- anything is written; if the Inventory changed since the preview the
-- whole import is refused ("stale") and nothing is written.
--   p_counts  [{id, key, counted}]  matched products: the file's balance -> a stock count
--   p_new     [{serial, description, specification, rate, balance}]  new products
--   p_fills   [{id, specification, rate}]  empty specification / rate to fill (only if still empty)
--   p_archive [uuid]  active products not in the file, archived on request
-- {status: ok | duplicate | stale | invalid | rate_limited, ...counts}
create or replace function public.inv_import_apply(
  p_batch_key text,
  p_counts    jsonb,
  p_new       jsonb,
  p_fills     jsonb,
  p_archive   uuid[],
  p_rows      int
)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_today   date := public.inv_today();
  v_month   date := date_trunc('month', public.inv_today())::date;
  v_counts  jsonb := coalesce(p_counts, '[]'::jsonb);
  v_new     jsonb := coalesce(p_new, '[]'::jsonb);
  v_fills   jsonb := coalesce(p_fills, '[]'::jsonb);
  v_archive uuid[] := coalesce(p_archive, '{}'::uuid[]);
  v_run     public.inv_import_runs;
  v_run_id  bigint;
  v_ids     uuid[];
  e         jsonb;
  v_p       public.inv_products;
  v_new_p   public.inv_products;
  v_num     numeric;
  v_rate    numeric;
  v_spec    text;
  v_serial  text;
  v_desc    text;
  v_adj     int := 0;
  v_fill    int := 0;
  v_i       int := 0;
  v_before  numeric;
  v_pending boolean;
begin
  if not public.inv_can_manage() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_batch_key is null or char_length(p_batch_key) not between 8 and 120 then
    return jsonb_build_object('status', 'invalid', 'message', 'Please read the file again.');
  end if;
  if jsonb_typeof(v_counts) <> 'array' or jsonb_typeof(v_new) <> 'array' or jsonb_typeof(v_fills) <> 'array' then
    return jsonb_build_object('status', 'invalid', 'message', 'The import is not in the right form.');
  end if;
  if jsonb_array_length(v_counts) + jsonb_array_length(v_new) > 5000 or jsonb_array_length(v_fills) > 5000
     or coalesce(array_length(v_archive, 1), 0) > 5000 then
    return jsonb_build_object('status', 'invalid', 'message', 'At most 5,000 rows per import.');
  end if;

  -- the same batch twice (double tap): wait for the first, then answer with its result
  perform pg_advisory_xact_lock(hashtextextended(p_batch_key, 7243033));
  select * into v_run from public.inv_import_runs where batch_key = p_batch_key;
  if found then
    return jsonb_build_object('status', 'duplicate', 'run_id', v_run.id, 'counted', v_run.counted, 'adjusted', v_run.adjusted,
                              'added', v_run.added, 'filled', v_run.filled, 'archived', v_run.archived);
  end if;
  -- rate limit: 10 imports per 10 minutes per account
  if (select count(*) from public.inv_import_runs where created_by = auth.uid() and created_at > now() - interval '10 minutes') >= 10 then
    return jsonb_build_object('status', 'rate_limited', 'message', 'Too many imports in a short time. Wait a few minutes, then try again.');
  end if;
  if jsonb_array_length(v_counts) > 0 and v_month < public.inv_counts_from() then
    return jsonb_build_object('status', 'invalid',
      'message', 'Balances from a document can be recorded from ' || to_char(public.inv_counts_from(), 'FMDD FMMonth YYYY') || '.');
  end if;

  perform public.inv_rollover2();
  perform public.inv_ledger_lock(false);

  -- lock every product the import touches, in one order (no deadlock with another writer)
  select coalesce(array_agg(x order by x), '{}') into v_ids from (
    select (c ->> 'id')::uuid x from jsonb_array_elements(v_counts) c
    union select (f ->> 'id')::uuid from jsonb_array_elements(v_fills) f
    union select unnest(v_archive)) z;
  perform 1 from public.inv_products where id = any(v_ids) order by id for update;

  -- ── check everything against the data as it is now ─────────────────────
  if (select count(*) <> count(distinct c ->> 'id') from jsonb_array_elements(v_counts) c) then
    return jsonb_build_object('status', 'invalid', 'message', 'A product appears twice in the import.');
  end if;
  for e in select * from jsonb_array_elements(v_counts) loop
    select * into v_p from public.inv_products where id = (e ->> 'id')::uuid;
    if not found or not v_p.is_active or public.inv_serial_key(v_p.serial_no) <> coalesce(e ->> 'key', '') then
      return jsonb_build_object('status', 'stale',
        'message', 'The Inventory changed since the preview (a product was renamed, archived or removed). Read the file again.');
    end if;
    begin
      v_num := (e ->> 'counted')::numeric;
    exception when others then
      v_num := null;
    end;
    if v_num is null or v_num < 0 or v_num <> round(v_num, 3) or v_num >= 100000000000 then
      return jsonb_build_object('status', 'invalid', 'message', 'A balance in the import is not usable (' || v_p.serial_no || ').');
    end if;
    if v_num <> public.inv_balance_now(v_p.id) then v_adj := v_adj + 1; end if;
  end loop;

  if (select count(*) <> count(distinct public.inv_serial_key(n ->> 'serial')) from jsonb_array_elements(v_new) n) then
    return jsonb_build_object('status', 'invalid', 'message', 'A new serial appears twice in the import.');
  end if;
  for e in select * from jsonb_array_elements(v_new) loop
    v_serial := btrim(coalesce(e ->> 'serial', ''));
    v_desc := btrim(coalesce(e ->> 'description', ''));
    v_spec := btrim(coalesce(e ->> 'specification', ''));
    if char_length(v_serial) not between 1 and 40 or char_length(v_desc) not between 1 and 300 or char_length(v_spec) > 300 then
      return jsonb_build_object('status', 'invalid', 'message', 'A new product needs a serial (40 characters at most) and a description (300 at most).');
    end if;
    if exists (select 1 from public.inv_products where public.inv_serial_key(serial_no) = public.inv_serial_key(v_serial)) then
      return jsonb_build_object('status', 'stale', 'message', 'Serial ' || v_serial || ' exists now. Read the file again.');
    end if;
    begin
      v_num := (e ->> 'balance')::numeric;
      v_rate := nullif(e ->> 'rate', '')::numeric;
    exception when others then
      return jsonb_build_object('status', 'invalid', 'message', 'A number in the import is not usable (' || v_serial || ').');
    end;
    if v_num is null or v_num < 0 or v_num <> round(v_num, 3) or v_num >= 100000000000
       or (v_rate is not null and (v_rate < 0 or v_rate <> round(v_rate, 2) or v_rate >= 1000000000000)) then
      return jsonb_build_object('status', 'invalid', 'message', 'A number in the import is not usable (' || v_serial || ').');
    end if;
  end loop;

  for e in select * from jsonb_array_elements(v_fills) loop
    select * into v_p from public.inv_products where id = (e ->> 'id')::uuid;
    if not found or not v_p.is_active then
      return jsonb_build_object('status', 'stale', 'message', 'The Inventory changed since the preview. Read the file again.');
    end if;
    begin
      v_rate := nullif(e ->> 'rate', '')::numeric;
    exception when others then
      return jsonb_build_object('status', 'invalid', 'message', 'A rate in the import is not usable (' || v_p.serial_no || ').');
    end;
    if (v_rate is not null and (v_rate < 0 or v_rate <> round(v_rate, 2) or v_rate >= 1000000000000))
       or char_length(btrim(coalesce(e ->> 'specification', ''))) > 300 then
      return jsonb_build_object('status', 'invalid', 'message', 'A rate or specification in the import is not usable (' || v_p.serial_no || ').');
    end if;
    -- filled only where it is STILL empty (never overwrites)
    if (btrim(v_p.specification) = '' and btrim(coalesce(e ->> 'specification', '')) <> '') or (v_p.rate is null and v_rate is not null) then
      v_fill := v_fill + 1;
    end if;
  end loop;

  if exists (select 1 from unnest(v_archive) a(id)
              where not exists (select 1 from public.inv_products p where p.id = a.id and p.is_active)
                 or exists (select 1 from jsonb_array_elements(v_counts) c where (c ->> 'id')::uuid = a.id)) then
    return jsonb_build_object('status', 'stale', 'message', 'A product to archive changed since the preview. Read the file again.');
  end if;

  -- ── write ───────────────────────────────────────────────────────────────
  insert into public.inv_import_runs (batch_key, rows_in_file, counted, adjusted, added, filled, archived, created_by)
  values (p_batch_key, greatest(0, coalesce(p_rows, 0)), jsonb_array_length(v_counts), v_adj, jsonb_array_length(v_new),
          v_fill, coalesce(array_length(v_archive, 1), 0), auth.uid())
  returning id into v_run_id;

  for e in select * from jsonb_array_elements(v_counts) loop
    v_i := v_i + 1;
    v_pending := public.inv_is_pending((e ->> 'id')::uuid, v_month);
    v_before := public.inv_balance_now((e ->> 'id')::uuid);
    insert into public.inv_stock_counts (product_id, month, entry_date, counted, balance_before, source, note,
                                         idempotency_key, created_by, import_run_id)
    values ((e ->> 'id')::uuid, v_month, case when v_pending then v_month else v_today end, (e ->> 'counted')::numeric,
            v_before, 'import', 'Imported from a document', p_batch_key || ':c' || v_i, auth.uid(), v_run_id);
  end loop;

  for e in select * from jsonb_array_elements(v_new) loop
    insert into public.inv_products (serial_no, description, specification, rate, opening_qty, opening_month, created_by)
    values (btrim(e ->> 'serial'), btrim(e ->> 'description'), btrim(coalesce(e ->> 'specification', '')),
            nullif(e ->> 'rate', '')::numeric, (e ->> 'balance')::numeric, v_month, auth.uid())
    returning * into v_new_p;
    insert into public.inv_product_log (product_id, action, after, actor)
    values (v_new_p.id, 'import', public.inv_product_json(v_new_p), auth.uid());
  end loop;

  for e in select * from jsonb_array_elements(v_fills) loop
    select * into v_p from public.inv_products where id = (e ->> 'id')::uuid;
    v_spec := btrim(coalesce(e ->> 'specification', ''));
    v_rate := nullif(e ->> 'rate', '')::numeric;
    update public.inv_products
       set specification = case when btrim(specification) = '' and v_spec <> '' then v_spec else specification end,
           rate = coalesce(rate, v_rate)
     where id = v_p.id
       and ((btrim(specification) = '' and v_spec <> '') or (rate is null and v_rate is not null))
    returning * into v_new_p;
    if found then
      insert into public.inv_product_log (product_id, action, before, after, actor)
      values (v_p.id, 'import', public.inv_product_json(v_p), public.inv_product_json(v_new_p), auth.uid());
    end if;
  end loop;

  for v_i in 1 .. coalesce(array_length(v_archive, 1), 0) loop
    perform public.inv_set_product_active(v_archive[v_i], false);
  end loop;

  return jsonb_build_object('status', 'ok', 'run_id', v_run_id, 'counted', jsonb_array_length(v_counts), 'adjusted', v_adj,
                            'added', jsonb_array_length(v_new), 'filled', v_fill, 'archived', coalesce(array_length(v_archive, 1), 0));
end $$;

do $$
begin
  revoke all on function public.inv_import_apply(text, jsonb, jsonb, jsonb, uuid[], int) from public, anon;
  grant execute on function public.inv_import_apply(text, jsonb, jsonb, jsonb, uuid[], int) to authenticated, service_role;
  revoke all on function public.inv_serial_key(text) from public, anon;
  grant execute on function public.inv_serial_key(text) to authenticated, service_role;
end $$;

commit;
