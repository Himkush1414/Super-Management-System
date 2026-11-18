#!/usr/bin/env node
// ============================================================================
// What would the month rollover do? A READ-ONLY dry run.
//
//   node scripts/inventory/rollover-dry-run.mjs                    # as of the 1st of next month (IST)
//   node scripts/inventory/rollover-dry-run.mjs --as-of 2026-12-01
//
// One SELECT inside "begin read only … rollback" through the Management API
// (SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF in the shell), so Postgres
// itself refuses any write. It prints COUNTS ONLY: no serial, description,
// party, quantity or any other row content. Works before and after
// migration 0031 (it only reads the 0031 tables when they exist).
//
// It answers: which months the rollover would close, how many snapshot
// rows each would get, and how many products would start the month
// "pending" (balance to be counted).
// ============================================================================
import { loadEnv, managementQuery, projectRef } from "./lib.mjs";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** The 1st of the month after `day` ("2026-11-18" -> "2026-12-01"). */
export function nextMonth(day) {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** Today in India, "YYYY-MM-DD". */
export function istDay(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** The read-only SQL (exported for the tests). `asOf` is a checked YYYY-MM-DD. */
export function dryRunSql(asOf) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("--as-of must be YYYY-MM-DD");
  // a count from a table that may not exist yet: only evaluated when it does
  const opt = (table, query) =>
    `case when to_regclass('public.${table}') is null then null else
       (xpath('/row/n/text()', query_to_xml(${query}, false, true, '')))[1]::text::bigint end`;
  return `
with a as (select date_trunc('month', '${asOf}'::date)::date as cur),
     cfg as (select ${opt("inv_count_settings", `'select extract(epoch from counts_from)::bigint as n from public.inv_count_settings where id'`)} as from_epoch),
     f as (select coalesce(to_timestamp((select from_epoch from cfg))::date, 'infinity'::date) as counts_from),
     first as (select min(opening_month) as m from public.inv_products),
     old_next as (select coalesce((select (max(month) + interval '1 month')::date from public.inv_closed_months), (select m from first)) as m),
     new_next as (select ${opt("inv_closed_months2", `'select extract(epoch from (max(month) + interval ''1 month''))::bigint as n from public.inv_closed_months2'`)} as e),
     months as (
       select g.m::date as m
         from a, f, old_next, first,
              generate_series(old_next.m, (a.cur - interval '1 month')::date, interval '1 month') g(m)
        where old_next.m is not null and g.m::date < least(a.cur, f.counts_from)
       union
       select g.m::date
         from a, f, first, new_next,
              generate_series(greatest(f.counts_from, first.m, coalesce(to_timestamp(new_next.e)::date, '-infinity'::date)),
                              (a.cur - interval '1 month')::date, interval '1 month') g(m)
        where f.counts_from < a.cur and first.m is not null)
select
  (select cur from a)::text as as_of_month,
  (select case when counts_from = 'infinity' then null else counts_from::text end from f) as counts_from,
  (select count(*) from public.inv_closed_months) as closed_months_0028,
  ${opt("inv_closed_months2", `'select count(*) as n from public.inv_closed_months2'`)} as closed_months_0031,
  (select coalesce(jsonb_agg(jsonb_build_object(
            'month', m::text,
            'table', case when m < (select counts_from from f) then 'inv_month_snapshots' else 'inv_month_snapshots2' end,
            'snapshot_rows', (select count(*) from public.inv_products p where p.opening_month <= m),
            'archived_in_it', (select count(*) from public.inv_products p where p.opening_month <= m and not p.is_active),
            'ledger_entries_in_month', (select count(*) from public.inv_transactions t
                                          where t.entry_date >= m and t.entry_date < (m + interval '1 month')::date))
          order by m), '[]'::jsonb) from months) as months_to_close,
  (select count(*) from public.inv_products where is_active) as active_products,
  (select count(*) from public.inv_products where not is_active) as archived_products,
  (select count(*) from public.inv_products p, a where p.is_active and p.opening_month < a.cur) as would_be_pending_if_counting,
  (select case when (select counts_from from f) <= (select cur from a)
               then (select count(*) from public.inv_products p, a where p.is_active and p.opening_month < a.cur)
                    - coalesce(${opt("inv_stock_counts", `format('select count(distinct product_id) as n from public.inv_stock_counts where month = %L', (select cur from a))`)}, 0)
               else 0 end) as pending_on_as_of,
  (select count(*) from public.inv_products p, a where p.opening_month >= a.cur) as added_on_or_after_as_of,
  (select count(*) from public.inv_transactions) as ledger_entries_total,
  ${opt("inv_stock_counts", `'select count(*) as n from public.inv_stock_counts'`)} as stock_counts_total`;
}

async function main() {
  const env = loadEnv();
  if (!env.get("SUPABASE_ACCESS_TOKEN") || !projectRef(env)) {
    console.error("Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF in the shell.");
    process.exit(1);
  }
  const asOf = arg("--as-of") ?? nextMonth(istDay());
  const rows = await managementQuery(env, `begin read only;\n${dryRunSql(asOf)};\nrollback;`);
  const r = rows[0];
  if (!r) throw new Error("no answer from the database");
  const months = typeof r.months_to_close === "string" ? JSON.parse(r.months_to_close) : r.months_to_close;
  console.log(`Month rollover — DRY RUN (read-only, nothing is written)`);
  console.log(`  as of:                      ${r.as_of_month}`);
  console.log(`  month-start counting from:  ${r.counts_from ?? "not set (migration 0031 not applied)"}`);
  console.log(`  closed months now:          ${r.closed_months_0028} (0028 tables), ${r.closed_months_0031 ?? "—"} (0031 tables)`);
  console.log(`  months it would close:      ${months.length}`);
  for (const m of months) {
    console.log(`    ${m.month} -> ${m.table}: ${m.snapshot_rows} rows (${m.archived_in_it} archived), ${m.ledger_entries_in_month} ledger entries in the month`);
  }
  console.log(`  products: ${r.active_products} active, ${r.archived_products} archived, ${r.added_on_or_after_as_of} added on/after ${r.as_of_month}`);
  console.log(`  pending on ${r.as_of_month}:       ${r.pending_on_as_of} of ${r.active_products} active (balance to be counted)`);
  console.log(`  ledger entries: ${r.ledger_entries_total}; stock counts: ${r.stock_counts_total ?? "—"}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main().catch((e) => {
    console.error(`Dry run failed: ${e.message.replace(/sbp_[A-Za-z0-9]+/g, "<token>")}`);
    process.exit(1);
  });
}
