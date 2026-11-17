-- ============================================================================
-- NR Industries — 0028_inventory.sql
--
-- The Inventory module: the store's product list and a ledger of every
-- receipt and issue, for the `inventory` role (0027). head_admin / admin
-- can read everything; marketing and production get nothing.
--
-- ADDITIVE ONLY. Every object here is new and named inv_*; nothing that
-- existed before is altered, and no existing row is read or written. All
-- statements are idempotent (IF NOT EXISTS / CREATE OR REPLACE / guarded
-- DO blocks), so running the file twice changes nothing.
--
-- HOW THE NUMBERS WORK
--   * inv_transactions is an append-only ledger. A row is a receipt or an
--     issue of `qty` (> 0) on `entry_date`. A mistake is corrected by a
--     reversal: a new row of the same kind with `reverses_id` set, which
--     counts negative in that kind's column. Nothing is ever edited or
--     deleted (triggers refuse UPDATE / DELETE / TRUNCATE).
--   * A product's opening stock (opening_qty) is fixed when it is added and
--     counts from the first day of its opening_month.
--   * Balance at any day  = opening_qty + Σ delta (entries up to that day).
--     Opening of a month = balance before its first day = previous month's
--     closing, by construction. Receiving / Issue = that month's sums.
--   * inv_month_snapshots keeps one row per product per closed month
--     (opening, received, issued, closing). inv_rollover() writes them,
--     idempotently, the first time the module is opened in a new month —
--     every missing month in a gap, in order.
--   * Dates are IST (Asia/Kolkata). An entry's date must be in the current
--     month and not in the future, so a closed month never changes.
--   * Quantities are numeric(14,3), rates numeric(14,2): never float.
--
-- WHO MAY DO WHAT (same role source as every existing policy:
-- public.current_role_name(), i.e. profiles.role of auth.uid())
--   inventory              read + every write RPC
--   head_admin, admin      read only
--   marketing, production  nothing (RLS returns no rows, RPCs refuse)
--   anon                   no grants at all
-- Tables are SELECT-only for `authenticated` (and only through RLS); every
-- write goes through a SECURITY DEFINER function that checks the role first.
-- ============================================================================

begin;

-- ── 0. helpers ─────────────────────────────────────────────────────────────

-- Today's date in India, whatever the server's zone (UTC on Supabase).
create or replace function public.inv_today()
returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

create or replace function public.inv_can_view()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name()::text in ('inventory', 'head_admin', 'admin'), false)
$$;

create or replace function public.inv_can_manage()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name()::text = 'inventory', false)
$$;

-- The import script and the Management API run as the service role / the
-- database owner, never as a signed-in account.
create or replace function public.inv_is_service()
returns boolean
language sql stable set search_path = public as $$
  select session_user = 'postgres'
      or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
$$;

-- ── 1. tables ──────────────────────────────────────────────────────────────

-- Column definitions: the 8 default columns (locked) and the store's own
-- custom columns (add / rename / reorder / show-hide / archive).
create table if not exists public.inv_columns (
  id          uuid primary key default gen_random_uuid(),
  key         text unique,                       -- set on the default columns only
  label       text not null check (char_length(btrim(label)) between 1 and 40),
  data_type   text not null check (data_type in ('text', 'number', 'date')),
  position    int  not null,
  is_default  boolean not null default false,
  visible     boolean not null default true,
  archived_at timestamptz,
  archived_by uuid,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  check (not is_default or (key is not null and archived_at is null and visible))
);
create unique index if not exists inv_columns_label_active
  on public.inv_columns (lower(btrim(label))) where archived_at is null;

create table if not exists public.inv_products (
  id            uuid primary key default gen_random_uuid(),
  serial_no     text not null unique
                check (serial_no = btrim(serial_no) and char_length(serial_no) between 1 and 40),
  description   text not null default '' check (char_length(description) <= 300),
  specification text not null default '' check (char_length(specification) <= 300),
  rate          numeric(14,2) check (rate >= 0),
  opening_qty   numeric(14,3) not null default 0 check (opening_qty >= 0),
  opening_month date not null check (opening_month = date_trunc('month', opening_month)::date),
  custom        jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object'),
  is_active     boolean not null default true,
  archived_at   timestamptz,
  archived_by   uuid,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now()
);
-- "AB-12" and "ab-12" are the same serial
create unique index if not exists inv_products_serial_ci on public.inv_products (upper(serial_no));

create table if not exists public.inv_transactions (
  id              bigint generated always as identity primary key,
  product_id      uuid not null references public.inv_products(id),
  kind            text not null check (kind in ('receive', 'issue')),
  qty             numeric(14,3) not null check (qty > 0),
  entry_date      date not null,
  note            text check (char_length(note) <= 300),
  reverses_id     bigint unique references public.inv_transactions(id),
  source          text not null default 'app' check (source in ('app', 'import')),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 120),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  -- signed effect on the balance: + receipt, − issue; a reversal flips it
  delta           numeric(15,3) generated always as (
                    case when (kind = 'receive') = (reverses_id is null) then qty else -qty end
                  ) stored
);
create index if not exists inv_transactions_product_date on public.inv_transactions (product_id, entry_date);
create index if not exists inv_transactions_date on public.inv_transactions (entry_date);

create table if not exists public.inv_month_snapshots (
  product_id uuid not null references public.inv_products(id),
  month      date not null check (month = date_trunc('month', month)::date),
  opening    numeric(15,3) not null,
  received   numeric(15,3) not null,
  issued     numeric(15,3) not null,
  closing    numeric(15,3) not null,
  created_at timestamptz not null default now(),
  primary key (product_id, month),
  check (closing = opening + received - issued)
);

-- One row per month inv_rollover() has closed.
create table if not exists public.inv_closed_months (
  month     date primary key check (month = date_trunc('month', month)::date),
  products  int not null,
  closed_at timestamptz not null default now()
);

-- The inventory person (shown in the module's header). One row.
create table if not exists public.inv_settings (
  id          boolean primary key default true check (id),
  person_name text not null default '' check (char_length(person_name) <= 80),
  phone       text not null default '' check (phone ~ '^(\+?[0-9][0-9 -]{6,18}[0-9])?$'),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- Every change to a product's details (add, import, edit, archive, restore),
-- before and after: history stays intact.
create table if not exists public.inv_product_log (
  id         bigint generated always as identity primary key,
  product_id uuid not null references public.inv_products(id),
  action     text not null check (action in ('create', 'import', 'update', 'archive', 'restore')),
  before     jsonb,
  after      jsonb,
  actor      uuid,
  created_at timestamptz not null default now()
);
create index if not exists inv_product_log_product on public.inv_product_log (product_id, created_at);

-- ── 2. nothing is ever deleted ─────────────────────────────────────────────

create or replace function public.inv_forbid_change()
returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'inventory records are never % (%): archive or reverse instead',
    case tg_op when 'DELETE' then 'deleted' when 'TRUNCATE' then 'truncated' else 'edited' end,
    tg_table_name
    using errcode = '42501';
end $$;

-- append-only tables: no UPDATE, DELETE or TRUNCATE
create or replace trigger inv_transactions_append_only
  before update or delete on public.inv_transactions
  for each row execute function public.inv_forbid_change();
create or replace trigger inv_month_snapshots_append_only
  before update or delete on public.inv_month_snapshots
  for each row execute function public.inv_forbid_change();
create or replace trigger inv_closed_months_append_only
  before update or delete on public.inv_closed_months
  for each row execute function public.inv_forbid_change();
create or replace trigger inv_product_log_append_only
  before update or delete on public.inv_product_log
  for each row execute function public.inv_forbid_change();
-- archived, never deleted
create or replace trigger inv_products_no_delete
  before delete on public.inv_products
  for each row execute function public.inv_forbid_change();
create or replace trigger inv_columns_no_delete
  before delete on public.inv_columns
  for each row execute function public.inv_forbid_change();
create or replace trigger inv_settings_no_delete
  before delete on public.inv_settings
  for each row execute function public.inv_forbid_change();

create or replace trigger inv_transactions_no_truncate
  before truncate on public.inv_transactions for each statement execute function public.inv_forbid_change();
create or replace trigger inv_month_snapshots_no_truncate
  before truncate on public.inv_month_snapshots for each statement execute function public.inv_forbid_change();
create or replace trigger inv_closed_months_no_truncate
  before truncate on public.inv_closed_months for each statement execute function public.inv_forbid_change();
create or replace trigger inv_product_log_no_truncate
  before truncate on public.inv_product_log for each statement execute function public.inv_forbid_change();
create or replace trigger inv_products_no_truncate
  before truncate on public.inv_products for each statement execute function public.inv_forbid_change();
create or replace trigger inv_columns_no_truncate
  before truncate on public.inv_columns for each statement execute function public.inv_forbid_change();
create or replace trigger inv_settings_no_truncate
  before truncate on public.inv_settings for each statement execute function public.inv_forbid_change();

-- the default columns are locked: no rename, hide, move or archive
create or replace function public.inv_guard_default_column()
returns trigger
language plpgsql set search_path = public as $$
begin
  if old.is_default and (new.label is distinct from old.label
                         or new.key is distinct from old.key
                         or new.position is distinct from old.position
                         or new.visible is distinct from old.visible
                         or new.archived_at is distinct from old.archived_at
                         or new.is_default is distinct from old.is_default) then
    raise exception 'default inventory columns cannot be changed' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create or replace trigger inv_columns_guard_default
  before update on public.inv_columns
  for each row execute function public.inv_guard_default_column();

-- the opening stock and serial are fixed once a product exists
create or replace function public.inv_guard_product()
returns trigger
language plpgsql set search_path = public as $$
begin
  if new.serial_no is distinct from old.serial_no
     or new.opening_qty is distinct from old.opening_qty
     or new.opening_month is distinct from old.opening_month
     or new.created_at is distinct from old.created_at then
    raise exception 'a product''s serial number and opening balance never change' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create or replace trigger inv_products_guard
  before update on public.inv_products
  for each row execute function public.inv_guard_product();

-- ── 3. the default columns ─────────────────────────────────────────────────
insert into public.inv_columns (key, label, data_type, position, is_default) values
  ('serial_no',     'Serial No',            'text',   10, true),
  ('description',   'Material Description', 'text',   20, true),
  ('specification', 'Specification',        'text',   30, true),
  ('rate',          'Rate',                 'number', 40, true),
  ('opening',       'Opening Balance',      'number', 50, true),
  ('receiving',     'Receiving',            'number', 60, true),
  ('issue',         'Issue',                'number', 70, true),
  ('balance',       'Balance',              'number', 80, true)
on conflict (key) do nothing;

-- ── 4. row-level security ──────────────────────────────────────────────────
alter table public.inv_columns         enable row level security;
alter table public.inv_products        enable row level security;
alter table public.inv_transactions    enable row level security;
alter table public.inv_month_snapshots enable row level security;
alter table public.inv_closed_months   enable row level security;
alter table public.inv_settings        enable row level security;
alter table public.inv_product_log     enable row level security;

-- read: inventory + admin tier; no write policies at all (writes = RPCs)
do $$
declare t text;
begin
  foreach t in array array['inv_columns', 'inv_products', 'inv_transactions', 'inv_month_snapshots',
                           'inv_closed_months', 'inv_settings', 'inv_product_log'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                                              and policyname = t || '_read') then
      execute format('create policy %I on public.%I for select to authenticated '
                     'using ((select public.inv_can_view()))', t || '_read', t);
    end if;
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

-- ── 5. internal helpers ────────────────────────────────────────────────────

-- One lock shared by every ledger write and taken exclusively by the month
-- rollover, so a month is never closed while an entry for it is in flight.
create or replace function public.inv_ledger_lock(p_exclusive boolean)
returns void
language plpgsql set search_path = public as $$
begin
  if p_exclusive then perform pg_advisory_xact_lock(7243028);
  else perform pg_advisory_xact_lock_shared(7243028);
  end if;
end $$;

create or replace function public.inv_balance_of(p_product_id uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select p.opening_qty + coalesce((select sum(t.delta) from public.inv_transactions t
                                    where t.product_id = p.id), 0)
    from public.inv_products p where p.id = p_product_id
$$;

-- Custom-column values from the app: only active custom columns, each value
-- checked against its type, kept as text. {ok, value | message}
create or replace function public.inv_clean_custom(p_custom jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c record;
  v text;
  out jsonb := '{}'::jsonb;
begin
  if p_custom is null then return jsonb_build_object('ok', true, 'value', out); end if;
  if jsonb_typeof(p_custom) <> 'object' then
    return jsonb_build_object('ok', false, 'message', 'Custom values are not in the right form.');
  end if;
  for c in select id, label, data_type from public.inv_columns
            where not is_default and archived_at is null loop
    v := btrim(coalesce(p_custom ->> c.id::text, ''));
    continue when v = '';
    if char_length(v) > 200 then
      return jsonb_build_object('ok', false, 'message', c.label || ': at most 200 characters.');
    end if;
    if c.data_type = 'number' and v !~ '^-?[0-9]{1,12}(\.[0-9]{1,3})?$' then
      return jsonb_build_object('ok', false, 'message', c.label || ' must be a number.');
    end if;
    if c.data_type = 'date' then
      begin
        if v !~ '^\d{4}-\d{2}-\d{2}$' or to_char(v::date, 'YYYY-MM-DD') <> v then
          raise exception 'bad date';
        end if;
      exception when others then
        return jsonb_build_object('ok', false, 'message', c.label || ' must be a date.');
      end;
    end if;
    out := out || jsonb_build_object(c.id::text, v);
  end loop;
  return jsonb_build_object('ok', true, 'value', out);
end $$;

create or replace function public.inv_product_json(p public.inv_products)
returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('serial_no', p.serial_no, 'description', p.description,
           'specification', p.specification, 'rate', p.rate::text, 'opening_qty', p.opening_qty::text,
           'custom', p.custom, 'is_active', p.is_active)
$$;

-- Who recorded an entry: the inventory account's label (nothing for the
-- import, and never any other account's name).
create or replace function public.inv_actor_name(p_profile_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select p.full_name from public.profiles p
   where p.id = p_profile_id and p.role::text = 'inventory'
$$;

-- ── 6. month rollover ──────────────────────────────────────────────────────
-- Closes every ended month that isn't closed yet, oldest first: one
-- snapshot row per product that existed in it. Idempotent; usually a single
-- indexed read. Returns how many months it closed.
create or replace function public.inv_rollover()
returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  v_cur  date := date_trunc('month', public.inv_today())::date;
  v_m    date;
  v_n    int := 0;
  v_rows int;
begin
  if not (public.inv_can_view() or public.inv_is_service()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select (max(month) + interval '1 month')::date into v_m from public.inv_closed_months;
  v_m := coalesce(v_m, (select min(opening_month) from public.inv_products));
  if v_m is null or v_m >= v_cur then return 0; end if;

  perform public.inv_ledger_lock(true);
  -- re-read under the lock: another session may have closed it meanwhile
  select (max(month) + interval '1 month')::date into v_m from public.inv_closed_months;
  v_m := coalesce(v_m, (select min(opening_month) from public.inv_products));

  while v_m is not null and v_m < v_cur loop
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
  return v_n;
end $$;

-- ── 7. ledger writes (inventory only) ──────────────────────────────────────

-- Record a receipt or an issue. Row-locks the product, so two entries for
-- it never interleave; refuses an issue larger than the balance; the same
-- idempotency key twice records once (a double tap, a retried request).
-- {status: ok | duplicate | insufficient | invalid | not_found | archived, ...}
create or replace function public.inv_record_transaction(
  p_product_id      uuid,
  p_kind            text,
  p_qty             numeric,
  p_entry_date      date,
  p_note            text,
  p_idempotency_key text
)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_today  date := public.inv_today();
  v_p      public.inv_products;
  v_tx     public.inv_transactions;
  v_before numeric;
  v_id     bigint;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
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
    return jsonb_build_object('status', 'invalid', 'message', 'The note is longer than 300 characters.');
  end if;

  v_before := public.inv_balance_of(p_product_id);
  if p_kind = 'issue' and p_qty > v_before then
    return jsonb_build_object('status', 'insufficient', 'balance', v_before::text,
                              'message', 'Not enough stock for this issue.');
  end if;

  insert into public.inv_transactions (product_id, kind, qty, entry_date, note, source,
                                       idempotency_key, created_by)
  values (p_product_id, p_kind, p_qty, p_entry_date, v_note, 'app', p_idempotency_key, auth.uid())
  returning id into v_id;

  return jsonb_build_object('status', 'ok', 'id', v_id,
                            'balance_before', v_before::text,
                            'balance_after', (v_before + case when p_kind = 'receive' then p_qty else -p_qty end)::text);
end $$;

-- Reverse an entry of THIS month: a new entry of the same kind that cancels
-- it (dated today). Each entry can be reversed once; a reversal can't be.
create or replace function public.inv_reverse_transaction(
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
    return jsonb_build_object('status', 'invalid', 'message', 'The note is longer than 300 characters.');
  end if;

  v_before := public.inv_balance_of(v_p.id);
  v_after  := v_before - v_orig.delta;
  if v_after < 0 then
    return jsonb_build_object('status', 'insufficient', 'balance', v_before::text,
                              'message', 'Reversing this receipt would make the balance negative.');
  end if;

  insert into public.inv_transactions (product_id, kind, qty, entry_date, note, reverses_id, source,
                                       idempotency_key, created_by)
  values (v_p.id, v_orig.kind, v_orig.qty, v_today,
          coalesce(v_note, 'Reversal of entry #' || v_orig.id), v_orig.id, 'app',
          p_idempotency_key, auth.uid())
  returning id into v_id;

  return jsonb_build_object('status', 'ok', 'id', v_id,
                            'balance_before', v_before::text, 'balance_after', v_after::text);
end $$;

-- ── 8. products (inventory only) ───────────────────────────────────────────

create or replace function public.inv_add_product(
  p_serial_no     text,
  p_description   text,
  p_specification text,
  p_rate          numeric,
  p_opening_qty   numeric,
  p_custom        jsonb
)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_serial text := btrim(coalesce(p_serial_no, ''));
  v_clean  jsonb;
  v_dup    public.inv_products;
  v_p      public.inv_products;
begin
  if not public.inv_can_manage() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if char_length(v_serial) not between 1 and 40 then
    return jsonb_build_object('status', 'invalid', 'message', 'Enter a serial number (at most 40 characters).');
  end if;
  if char_length(btrim(coalesce(p_description, ''))) not between 1 and 300 then
    return jsonb_build_object('status', 'invalid', 'message', 'Enter a material description (at most 300 characters).');
  end if;
  if char_length(btrim(coalesce(p_specification, ''))) > 300 then
    return jsonb_build_object('status', 'invalid', 'message', 'The specification is longer than 300 characters.');
  end if;
  if p_rate is not null and (p_rate < 0 or p_rate <> round(p_rate, 2) or p_rate >= 1000000000000) then
    return jsonb_build_object('status', 'invalid', 'message', 'The rate must be 0 or more, with at most 2 decimals.');
  end if;
  if p_opening_qty is null or p_opening_qty < 0 or p_opening_qty <> round(p_opening_qty, 3)
     or p_opening_qty >= 100000000000 then
    return jsonb_build_object('status', 'invalid', 'message', 'The opening balance must be 0 or more, with at most 3 decimals.');
  end if;
  v_clean := public.inv_clean_custom(p_custom);
  if not (v_clean ->> 'ok')::boolean then
    return jsonb_build_object('status', 'invalid', 'message', v_clean ->> 'message');
  end if;

  select * into v_dup from public.inv_products where upper(serial_no) = upper(v_serial);
  if found then
    return jsonb_build_object('status', 'duplicate', 'archived', not v_dup.is_active,
      'message', case when v_dup.is_active
                      then 'Serial number ' || v_dup.serial_no || ' already exists.'
                      else 'Serial number ' || v_dup.serial_no || ' already exists (archived). Restore it instead.' end);
  end if;

  begin
    insert into public.inv_products (serial_no, description, specification, rate, opening_qty,
                                     opening_month, custom, created_by)
    values (v_serial, btrim(p_description), btrim(coalesce(p_specification, '')), p_rate, p_opening_qty,
            date_trunc('month', public.inv_today())::date, v_clean -> 'value', auth.uid())
    returning * into v_p;
  exception when unique_violation then
    return jsonb_build_object('status', 'duplicate', 'archived', false,
                              'message', 'Serial number ' || v_serial || ' already exists.');
  end;

  insert into public.inv_product_log (product_id, action, after, actor)
  values (v_p.id, 'create', public.inv_product_json(v_p), auth.uid());
  return jsonb_build_object('status', 'ok', 'id', v_p.id);
end $$;

-- Description, specification, rate and custom values. Serial number and
-- opening balance never change. Values of archived columns are kept.
create or replace function public.inv_update_product(
  p_product_id    uuid,
  p_description   text,
  p_specification text,
  p_rate          numeric,
  p_custom        jsonb
)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_old   public.inv_products;
  v_new   public.inv_products;
  v_clean jsonb;
  v_keep  jsonb;
begin
  if not public.inv_can_manage() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select * into v_old from public.inv_products where id = p_product_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'message', 'This product no longer exists.');
  end if;
  if char_length(btrim(coalesce(p_description, ''))) not between 1 and 300 then
    return jsonb_build_object('status', 'invalid', 'message', 'Enter a material description (at most 300 characters).');
  end if;
  if char_length(btrim(coalesce(p_specification, ''))) > 300 then
    return jsonb_build_object('status', 'invalid', 'message', 'The specification is longer than 300 characters.');
  end if;
  if p_rate is not null and (p_rate < 0 or p_rate <> round(p_rate, 2) or p_rate >= 1000000000000) then
    return jsonb_build_object('status', 'invalid', 'message', 'The rate must be 0 or more, with at most 2 decimals.');
  end if;
  v_clean := public.inv_clean_custom(p_custom);
  if not (v_clean ->> 'ok')::boolean then
    return jsonb_build_object('status', 'invalid', 'message', v_clean ->> 'message');
  end if;
  -- values of columns that aren't active custom columns stay as they were
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_keep
    from jsonb_each(v_old.custom) e(k, v)
   where not exists (select 1 from public.inv_columns c
                      where c.id::text = e.k and not c.is_default and c.archived_at is null);

  update public.inv_products
     set description = btrim(p_description),
         specification = btrim(coalesce(p_specification, '')),
         rate = p_rate,
         custom = v_keep || (v_clean -> 'value')
   where id = p_product_id
  returning * into v_new;

  if public.inv_product_json(v_old) is distinct from public.inv_product_json(v_new) then
    insert into public.inv_product_log (product_id, action, before, after, actor)
    values (p_product_id, 'update', public.inv_product_json(v_old), public.inv_product_json(v_new), auth.uid());
  end if;
  return jsonb_build_object('status', 'ok');
end $$;

-- Archive (p_active = false) or restore a product. Its ledger stays.
create or replace function public.inv_set_product_active(p_product_id uuid, p_active boolean)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_old public.inv_products;
  v_new public.inv_products;
begin
  if not public.inv_can_manage() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_active is null then
    return jsonb_build_object('status', 'invalid', 'message', 'Nothing to change.');
  end if;
  select * into v_old from public.inv_products where id = p_product_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'message', 'This product no longer exists.');
  end if;
  if v_old.is_active = p_active then
    return jsonb_build_object('status', 'ok');
  end if;
  update public.inv_products
     set is_active = p_active,
         archived_at = case when p_active then null else now() end,
         archived_by = case when p_active then null else auth.uid() end
   where id = p_product_id
  returning * into v_new;
  insert into public.inv_product_log (product_id, action, before, after, actor)
  values (p_product_id, case when p_active then 'restore' else 'archive' end,
          public.inv_product_json(v_old), public.inv_product_json(v_new), auth.uid());
  return jsonb_build_object('status', 'ok');
end $$;

-- ── 9. settings and custom columns (inventory only) ────────────────────────

create or replace function public.inv_save_settings(p_person_name text, p_phone text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_name  text := btrim(coalesce(p_person_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
begin
  if not public.inv_can_manage() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if char_length(v_name) > 80 then
    return jsonb_build_object('status', 'invalid', 'message', 'The name is longer than 80 characters.');
  end if;
  if v_phone !~ '^(\+?[0-9][0-9 -]{6,18}[0-9])?$' then
    return jsonb_build_object('status', 'invalid', 'message', 'Enter a valid phone number (digits, spaces, + and -).');
  end if;
  insert into public.inv_settings (id, person_name, phone, updated_at, updated_by)
  values (true, v_name, v_phone, now(), auth.uid())
  on conflict (id) do update
    set person_name = excluded.person_name, phone = excluded.phone,
        updated_at = now(), updated_by = excluded.updated_by;
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.inv_add_column(p_label text, p_data_type text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_label text := btrim(coalesce(p_label, ''));
  v_id    uuid;
begin
  if not public.inv_can_manage() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if char_length(v_label) not between 1 and 40 then
    return jsonb_build_object('status', 'invalid', 'message', 'Enter a column name (at most 40 characters).');
  end if;
  if p_data_type is null or p_data_type not in ('text', 'number', 'date') then
    return jsonb_build_object('status', 'invalid', 'message', 'Choose text, number or date.');
  end if;
  if exists (select 1 from public.inv_columns
              where archived_at is null and lower(btrim(label)) = lower(v_label)) then
    return jsonb_build_object('status', 'duplicate', 'message', 'A column named ' || v_label || ' already exists.');
  end if;
  insert into public.inv_columns (label, data_type, position, created_by)
  values (v_label, p_data_type,
          greatest(100, coalesce((select max(position) from public.inv_columns where not is_default), 90) + 10),
          auth.uid())
  returning id into v_id;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

-- Rename and/or show-hide a custom column (null = leave as is).
create or replace function public.inv_update_column(p_column_id uuid, p_label text, p_visible boolean)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_c     public.inv_columns;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  if not public.inv_can_manage() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select * into v_c from public.inv_columns where id = p_column_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'message', 'This column no longer exists.');
  end if;
  if v_c.is_default then
    return jsonb_build_object('status', 'invalid', 'message', 'Default columns are locked.');
  end if;
  if v_label is not null and char_length(v_label) > 40 then
    return jsonb_build_object('status', 'invalid', 'message', 'At most 40 characters.');
  end if;
  if v_label is not null and v_c.archived_at is null and exists (
       select 1 from public.inv_columns
        where archived_at is null and id <> v_c.id and lower(btrim(label)) = lower(v_label)) then
    return jsonb_build_object('status', 'duplicate', 'message', 'A column named ' || v_label || ' already exists.');
  end if;
  update public.inv_columns
     set label = coalesce(v_label, label), visible = coalesce(p_visible, visible)
   where id = p_column_id;
  return jsonb_build_object('status', 'ok');
end $$;

-- New order of the custom columns (ids, first to last).
create or replace function public.inv_reorder_columns(p_column_ids uuid[])
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  i int;
begin
  if not public.inv_can_manage() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_column_ids is null or exists (
       select 1 from unnest(p_column_ids) x(id)
        where not exists (select 1 from public.inv_columns c where c.id = x.id and not c.is_default)) then
    return jsonb_build_object('status', 'invalid', 'message', 'Only custom columns can be moved.');
  end if;
  for i in 1 .. coalesce(array_length(p_column_ids, 1), 0) loop
    update public.inv_columns set position = 100 + i * 10
     where id = p_column_ids[i] and position is distinct from 100 + i * 10;
  end loop;
  return jsonb_build_object('status', 'ok');
end $$;

-- Archive (hide for good, values kept) or restore a custom column.
create or replace function public.inv_set_column_archived(p_column_id uuid, p_archived boolean)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_c public.inv_columns;
begin
  if not public.inv_can_manage() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select * into v_c from public.inv_columns where id = p_column_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'message', 'This column no longer exists.');
  end if;
  if v_c.is_default then
    return jsonb_build_object('status', 'invalid', 'message', 'Default columns are locked.');
  end if;
  if p_archived is null or (p_archived = (v_c.archived_at is not null)) then
    return jsonb_build_object('status', 'ok');
  end if;
  if not p_archived and exists (select 1 from public.inv_columns
                                 where archived_at is null and lower(btrim(label)) = lower(btrim(v_c.label))) then
    return jsonb_build_object('status', 'duplicate',
                              'message', 'Another column is already named ' || v_c.label || '. Rename it first.');
  end if;
  update public.inv_columns
     set archived_at = case when p_archived then now() else null end,
         archived_by = case when p_archived then auth.uid() else null end,
         position = case when p_archived then position
                         else greatest(100, (select coalesce(max(position), 90) from public.inv_columns
                                              where not is_default and archived_at is null) + 10) end
   where id = p_column_id;
  return jsonb_build_object('status', 'ok');
end $$;

-- ── 10. reads (inventory + admin tier; SECURITY INVOKER, so RLS applies) ──

-- Everything the module's main page shows, in one call: columns, the
-- inventory person, the months that can be viewed, every product with its
-- figures for the month, the 6-month trend and the month's top 10 issued.
-- p_month null (or the current month) = live figures from the ledger; a
-- closed month = its snapshots. Closes ended months first (inv_rollover).
create or replace function public.inv_overview(p_month date default null)
returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_today date := public.inv_today();
  v_cur   date := date_trunc('month', public.inv_today())::date;
  v_month date := date_trunc('month', coalesce(p_month, public.inv_today()))::date;
  v_past  boolean;
  v_products jsonb;
begin
  if not public.inv_can_view() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.inv_rollover();

  v_past := v_month < v_cur and exists (select 1 from public.inv_closed_months where month = v_month);
  if not v_past then v_month := v_cur; end if;

  if v_past then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'serial_no', p.serial_no, 'description', p.description,
             'specification', p.specification, 'rate', p.rate::text, 'custom', p.custom,
             'is_active', p.is_active, 'created_at', p.created_at,
             'opening', s.opening::text, 'received', s.received::text,
             'issued', s.issued::text, 'balance', s.closing::text)
           order by p.serial_no), '[]'::jsonb)
      into v_products
      from public.inv_month_snapshots s
      join public.inv_products p on p.id = s.product_id
     where s.month = v_month;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'serial_no', p.serial_no, 'description', p.description,
             'specification', p.specification, 'rate', p.rate::text, 'custom', p.custom,
             'is_active', p.is_active, 'created_at', p.created_at,
             'opening', (p.opening_qty + x.before)::text, 'received', x.received::text,
             'issued', x.issued::text, 'balance', (p.opening_qty + x.before + x.received - x.issued)::text)
           order by p.serial_no), '[]'::jsonb)
      into v_products
      from public.inv_products p
      cross join lateral (
        select coalesce(sum(t.delta) filter (where t.entry_date < v_cur), 0) as before,
               coalesce(sum(t.delta) filter (where t.entry_date >= v_cur and t.kind = 'receive'), 0) as received,
               coalesce(-(sum(t.delta) filter (where t.entry_date >= v_cur and t.kind = 'issue')), 0) as issued
          from public.inv_transactions t
         where t.product_id = p.id) x;
  end if;

  return jsonb_build_object(
    'today', v_today,
    'current_month', v_cur,
    'month', v_month,
    'is_current', not v_past,
    'columns', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', c.id, 'key', c.key, 'label', c.label, 'data_type', c.data_type,
                  'position', c.position, 'is_default', c.is_default, 'visible', c.visible,
                  'archived', c.archived_at is not null)
                order by c.is_default desc, c.position), '[]'::jsonb)
                from public.inv_columns c),
    'settings', (select jsonb_build_object('person_name', s.person_name, 'phone', s.phone)
                   from public.inv_settings s where s.id),
    'months', (select coalesce(jsonb_agg(m.month order by m.month desc), '[]'::jsonb)
                 from public.inv_closed_months m),
    'products', v_products,
    'trend', (select coalesce(jsonb_agg(jsonb_build_object(
                'month', g.m,
                'received', coalesce((select sum(t.delta) from public.inv_transactions t
                                       where t.kind = 'receive' and t.entry_date >= g.m
                                         and t.entry_date < (g.m + interval '1 month')::date), 0)::text,
                'issued', coalesce(-(select sum(t.delta) from public.inv_transactions t
                                      where t.kind = 'issue' and t.entry_date >= g.m
                                        and t.entry_date < (g.m + interval '1 month')::date), 0)::text)
              order by g.m), '[]'::jsonb)
              from generate_series((v_month - interval '5 months')::date, v_month, interval '1 month') g(m)),
    'top_issued', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', q.id, 'serial_no', q.serial_no, 'description', q.description,
                     'specification', q.specification, 'issued', q.issued::text)
                   order by q.issued desc, q.serial_no), '[]'::jsonb)
                   from (select p.id, p.serial_no, p.description, p.specification,
                                -sum(t.delta) as issued
                           from public.inv_transactions t
                           join public.inv_products p on p.id = t.product_id
                          where t.kind = 'issue' and t.entry_date >= v_month
                            and t.entry_date < (v_month + interval '1 month')::date
                          group by p.id
                         having -sum(t.delta) > 0
                          order by issued desc, p.serial_no
                          limit 10) q)
  );
end $$;

-- One product's recent ledger entries (newest first), its detail changes
-- and its closed months.
create or replace function public.inv_product_history(p_product_id uuid, p_limit int default 25)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_cur date := date_trunc('month', public.inv_today())::date;
begin
  if not public.inv_can_view() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'entries', (select coalesce(jsonb_agg(e order by (e ->> 'id')::bigint desc), '[]'::jsonb) from (
        select jsonb_build_object(
                 'id', t.id, 'kind', t.kind, 'qty', t.qty::text, 'delta', t.delta::text,
                 'entry_date', t.entry_date, 'note', t.note, 'source', t.source,
                 'created_at', t.created_at, 'reverses_id', t.reverses_id,
                 'reversed_by', (select r.id from public.inv_transactions r where r.reverses_id = t.id),
                 'reversible', t.reverses_id is null and t.entry_date >= v_cur
                               and not exists (select 1 from public.inv_transactions r where r.reverses_id = t.id),
                 'by', public.inv_actor_name(t.created_by)) as e
          from public.inv_transactions t
         where t.product_id = p_product_id
         order by t.id desc
         limit greatest(1, least(coalesce(p_limit, 25), 200))) z),
    'months', (select coalesce(jsonb_agg(jsonb_build_object(
                 'month', s.month, 'opening', s.opening::text, 'received', s.received::text,
                 'issued', s.issued::text, 'closing', s.closing::text) order by s.month desc), '[]'::jsonb)
                 from (select * from public.inv_month_snapshots
                        where product_id = p_product_id order by month desc limit 12) s),
    'changes', (select coalesce(jsonb_agg(jsonb_build_object(
                  'action', l.action, 'created_at', l.created_at, 'before', l.before, 'after', l.after)
                  order by l.id desc), '[]'::jsonb)
                  from (select * from public.inv_product_log
                         where product_id = p_product_id order by id desc limit 10) l)
  );
end $$;

-- Figures for any date range (the exports): Opening = balance before
-- p_from, Received / Issued = sums inside [p_from, p_to], Closing = balance
-- at the end of p_to. Active products, plus archived ones that moved.
-- p_from null = from the first month any product has stock ("All").
create or replace function public.inv_range_report(p_from date, p_to date)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.inv_can_view() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_from is null then
    p_from := least(coalesce((select min(opening_month) from public.inv_products),
                             date_trunc('month', public.inv_today())::date), p_to);
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
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
                   'opening', (p.opening_qty + x.before)::text, 'received', x.received::text,
                   'issued', x.issued::text, 'balance', (p.opening_qty + x.before + x.received - x.issued)::text)
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
                where p.opening_month <= p_to and (p.is_active or x.moves > 0))
  );
end $$;

-- ── 11. import (service role only: scripts/inventory/import-docx.mjs) ─────
-- Upsert on serial_no. A new product gets its opening balance and, if the
-- sheet has them, this month's receipts / issues as ledger entries (one per
-- filled cell, keyed so a re-run adds nothing). An existing product only
-- gets its description / specification / rate / custom values refreshed;
-- its opening balance and ledger are never touched. Atomic: one bad row
-- and nothing is written.
create or replace function public.inv_import_products(p_payload jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_today   date := public.inv_today();
  v_month   date := date_trunc('month', public.inv_today())::date;
  col       jsonb;
  item      jsonb;
  mv        jsonb;
  v_labels  jsonb := '{}'::jsonb;   -- lower(label) -> column id
  v_custom  jsonb;
  v_p       public.inv_products;
  v_new     public.inv_products;
  v_serial  text;
  v_bal     numeric;
  v_ins int := 0; v_upd int := 0; v_same int := 0; v_mv int := 0; v_mv_skip int := 0; v_cols int := 0;
  v_rows int;
begin
  if not public.inv_is_service() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.inv_ledger_lock(false);

  for col in select * from jsonb_array_elements(coalesce(p_payload -> 'columns', '[]'::jsonb)) loop
    if not exists (select 1 from public.inv_columns
                    where archived_at is null and lower(btrim(label)) = lower(btrim(col ->> 'label'))) then
      insert into public.inv_columns (label, data_type, position)
      values (btrim(col ->> 'label'), coalesce(col ->> 'data_type', 'text'),
              greatest(100, coalesce((select max(position) from public.inv_columns where not is_default), 90) + 10));
      v_cols := v_cols + 1;
    end if;
  end loop;
  select coalesce(jsonb_object_agg(lower(btrim(label)), id), '{}'::jsonb) into v_labels
    from public.inv_columns where archived_at is null and not is_default;

  for item in select * from jsonb_array_elements(p_payload -> 'products') loop
    v_serial := btrim(item ->> 'serial_no');
    select coalesce(jsonb_object_agg(v_labels ->> lower(btrim(k)), v), '{}'::jsonb) into v_custom
      from jsonb_each_text(coalesce(item -> 'custom', '{}'::jsonb)) e(k, v)
     where v_labels ? lower(btrim(k)) and btrim(v) <> '';

    select * into v_p from public.inv_products where upper(serial_no) = upper(v_serial) for update;
    if not found then
      insert into public.inv_products (serial_no, description, specification, rate, opening_qty,
                                       opening_month, custom)
      values (v_serial, btrim(coalesce(item ->> 'description', '')), btrim(coalesce(item ->> 'specification', '')),
              nullif(item ->> 'rate', '')::numeric, coalesce(nullif(item ->> 'opening_qty', '')::numeric, 0),
              v_month, v_custom)
      returning * into v_new;
      insert into public.inv_product_log (product_id, action, after)
      values (v_new.id, 'import', public.inv_product_json(v_new));
      v_ins := v_ins + 1;

      for mv in select * from jsonb_array_elements(coalesce(item -> 'movements', '[]'::jsonb)) loop
        insert into public.inv_transactions (product_id, kind, qty, entry_date, note, source, idempotency_key)
        values (v_new.id, mv ->> 'kind', (mv ->> 'qty')::numeric, v_today,
                'Imported from the material movement sheet',
                'import', 'import:' || upper(v_serial) || ':' || (mv ->> 'kind') || ':' || (mv ->> 'slot'))
        on conflict (idempotency_key) do nothing;
        get diagnostics v_rows = row_count;
        if v_rows = 1 then v_mv := v_mv + 1; else v_mv_skip := v_mv_skip + 1; end if;
      end loop;

      v_bal := public.inv_balance_of(v_new.id);
      if v_bal < 0 then
        raise exception 'import: % would have a negative balance (%)', v_serial, v_bal;
      end if;
      if item ? 'expected_balance' and v_bal <> (item ->> 'expected_balance')::numeric then
        raise exception 'import: % balance % does not match the sheet (%)', v_serial, v_bal, item ->> 'expected_balance';
      end if;
    else
      update public.inv_products
         set description = btrim(coalesce(item ->> 'description', '')),
             specification = btrim(coalesce(item ->> 'specification', '')),
             rate = nullif(item ->> 'rate', '')::numeric,
             custom = custom || v_custom
       where id = v_p.id
         and (description, specification, rate, custom)
             is distinct from (btrim(coalesce(item ->> 'description', '')), btrim(coalesce(item ->> 'specification', '')),
                               nullif(item ->> 'rate', '')::numeric, custom || v_custom)
      returning * into v_new;
      if found then
        insert into public.inv_product_log (product_id, action, before, after)
        values (v_p.id, 'import', public.inv_product_json(v_p), public.inv_product_json(v_new));
        v_upd := v_upd + 1;
      else
        v_same := v_same + 1;
      end if;
      v_mv_skip := v_mv_skip + jsonb_array_length(coalesce(item -> 'movements', '[]'::jsonb));
    end if;
  end loop;

  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'unchanged', v_same,
                            'movements_inserted', v_mv, 'movements_skipped', v_mv_skip,
                            'columns_created', v_cols);
end $$;

-- ── 12. who may call what ──────────────────────────────────────────────────
do $$
declare f text;
begin
  -- signed-in accounts (each function checks the role itself)
  foreach f in array array[
    'inv_today()', 'inv_can_view()', 'inv_can_manage()', 'inv_rollover()',
    'inv_record_transaction(uuid, text, numeric, date, text, text)',
    'inv_reverse_transaction(bigint, text, text)',
    'inv_add_product(text, text, text, numeric, numeric, jsonb)',
    'inv_update_product(uuid, text, text, numeric, jsonb)',
    'inv_set_product_active(uuid, boolean)',
    'inv_save_settings(text, text)',
    'inv_add_column(text, text)', 'inv_update_column(uuid, text, boolean)',
    'inv_reorder_columns(uuid[])', 'inv_set_column_archived(uuid, boolean)',
    'inv_overview(date)', 'inv_product_history(uuid, int)', 'inv_range_report(date, date)',
    'inv_actor_name(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  -- internal helpers: nobody calls them over the API
  foreach f in array array[
    'inv_is_service()', 'inv_ledger_lock(boolean)', 'inv_balance_of(uuid)',
    'inv_clean_custom(jsonb)', 'inv_product_json(public.inv_products)',
    'inv_forbid_change()', 'inv_guard_default_column()', 'inv_guard_product()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  -- the import: service role only
  execute 'revoke all on function public.inv_import_products(jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.inv_import_products(jsonb) to service_role';
end $$;

commit;
