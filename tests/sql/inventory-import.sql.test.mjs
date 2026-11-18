// "Import from document" (0033): the apply step, in one transaction. PGlite, fake data only.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeDb, asUser } from "./harness.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ROLES = ["head_admin", "admin", "marketing", "production", "dispatcher", "inventory"];

async function setup() {
  const db = await makeDb(REPO);
  const ids = {};
  for (const role of ROLES) {
    const id = randomUUID();
    ids[role] = id;
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
      [id, `test-${role}@example.invalid`, JSON.stringify({ username: `test_${role}`, full_name: `Test ${role}`, role })]);
    await db.query(`update public.profiles set role = $2::user_role where id = $1`, [id, role]);
  }
  await db.query(`update public.inv_count_settings set counts_from = '2026-12-01'`);
  return { db, ids };
}
const setToday = (db, iso) => db.exec(`create or replace function public.inv_today() returns date language sql stable
                 set search_path = public as $$ select '${iso}'::date $$;`);
const rpc = (tx, fn, args = {}) => {
  const names = Object.keys(args);
  return tx.query(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, Object.values(args)).then((x) => x.rows[0].r);
};
const as = (db, id, fn) => asUser(db, id, fn);
const denied = (p) => assert.rejects(p, (e) => /not permitted|permission denied/.test(e.message));
const n = async (db, sql, args = []) => (await db.query(sql, args)).rows[0].n;

async function add(db, ids, serial, opening, spec = "", rate = null) {
  const r = await as(db, ids.inventory, (tx) => rpc(tx, "inv_add_product", { p_serial_no: serial, p_description: `Dummy ${serial}`,
    p_specification: spec, p_rate: rate, p_opening_qty: opening, p_custom: "{}" }));
  assert.equal(r.status, "ok");
  return r.id;
}
const apply = (db, who, args) => as(db, who, (tx) => rpc(tx, "inv_import_apply", {
  p_batch_key: args.key ?? randomUUID(), p_counts: JSON.stringify(args.counts ?? []), p_new: JSON.stringify(args.added ?? []),
  p_fills: JSON.stringify(args.fills ?? []), p_archive: args.archive ?? [], p_rows: args.rows ?? 0 }));

async function store(db, ids) {
  await setToday(db, "2026-11-17");
  const a = await add(db, ids, "ZZ-701", "10");
  const b = await add(db, ids, "ZZ 702", "4", "", null); // a serial with a space
  const c = await add(db, ids, "ZZ-703", "1", "Old spec", "5.00");
  const d = await add(db, ids, "ZZ-704", "3");
  return { a, b, c, d };
}

test("apply: stock counts for matched products, new products, blanks filled, others archived — one transaction", async () => {
  const { db, ids } = await setup();
  const { a, b, c, d } = await store(db, ids);
  await setToday(db, "2026-12-02");
  const key = randomUUID();
  const r = await apply(db, ids.inventory, {
    key, rows: 7,
    counts: [{ id: a, key: "ZZ-701", counted: "8" }, { id: b, key: "ZZ702", counted: "4" }, { id: c, key: "ZZ-703", counted: "1.5" }],
    added: [{ serial: "ZZ-790", description: "Fake imported part", specification: "6 mm", rate: "99.00", balance: "5" },
            { serial: "ZZ-791", description: "=1+1", specification: "", rate: null, balance: "0.125" }],
    fills: [{ id: b, specification: "2 mm", rate: "8.40" }, { id: c, specification: "New spec", rate: "9.99" }],
    archive: [d],
  });
  assert.deepEqual(r, { status: "ok", run_id: r.run_id, counted: 3, adjusted: 2, added: 2, filled: 1, archived: 1 });
  // stock counts: source import, run recorded, the month-start date for pending products
  const counts = (await db.query(`select p.serial_no, c.adjustment::text adj, c.entry_date::text d, c.source, c.import_run_id
                                    from public.inv_stock_counts c join public.inv_products p on p.id = c.product_id order by p.serial_no`)).rows;
  assert.deepEqual(counts.map((x) => [x.serial_no, x.adj, x.d, x.source, Number(x.import_run_id)]), [
    ["ZZ 702", "0.000", "2026-12-01", "import", r.run_id], ["ZZ-701", "-2.000", "2026-12-01", "import", r.run_id], ["ZZ-703", "0.500", "2026-12-01", "import", r.run_id]]);
  // the page: confirmed, balances = the file's
  const pg = await as(db, ids.inventory, (tx) => rpc(tx, "inv_page3", { p_month: null, p_analytics: false }));
  const row = Object.fromEntries(pg.rows.map((x) => [x[1], { bal: x[10], active: x[6], pending: x[15], spec: x[3], rate: x[4] }]));
  assert.deepEqual(row["ZZ-701"], { bal: "8", active: true, pending: false, spec: "", rate: null });
  assert.equal(row["ZZ 702"].spec, "2 mm", "blank spec filled");
  assert.equal(row["ZZ 702"].rate, "8.4", "blank rate filled");
  assert.equal(row["ZZ-703"].spec, "Old spec", "an existing spec is never overwritten");
  assert.equal(row["ZZ-703"].rate, "5", "an existing rate is never overwritten");
  assert.equal(row["ZZ-704"].active, false, "archived on request");
  assert.equal(row["ZZ-790"].bal, "5");
  assert.equal(row["ZZ-790"].pending, false, "a new product is confirmed when added");
  assert.equal(row["ZZ-791"].bal, "0.125");
  assert.equal(pg.pending_count, 0);
  assert.equal(await n(db, `select count(*)::int n from public.inv_products where description = '=1+1'`), 1, "text that looks like a formula is stored as text");
  // the run record: counts only
  const run = (await db.query(`select * from public.inv_import_runs`)).rows[0];
  assert.deepEqual([run.rows_in_file, run.counted, run.adjusted, run.added, run.filled, run.archived, run.created_by], [7, 3, 2, 2, 1, 1, ids.inventory]);
  // the detail log: imports and the archive are logged
  assert.equal(await n(db, `select count(*)::int n from public.inv_product_log where action = 'import'`), 2 + 1); // 2 new + 1 fill
  assert.equal(await n(db, `select count(*)::int n from public.inv_product_log where action = 'archive'`), 1);
  // the same batch again (double tap): the same answer, nothing more
  const again = await apply(db, ids.inventory, { key, counts: [{ id: a, key: "ZZ-701", counted: "8" }] });
  assert.equal(again.status, "duplicate");
  assert.equal(again.counted, 3);
  assert.equal(await n(db, `select count(*)::int n from public.inv_stock_counts`), 3);
  assert.equal(await n(db, `select count(*)::int n from public.inv_import_runs`), 1);
});

test("stale preview: re-checked at apply time, nothing written", async () => {
  const { db, ids } = await setup();
  const { a, b } = await store(db, ids);
  await setToday(db, "2026-12-02");
  const before = await n(db, `select count(*)::int n from public.inv_stock_counts`);
  const cases = [
    { counts: [{ id: a, key: "ZZ-799", counted: "1" }] }, // the serial isn't that product's
    { counts: [{ id: randomUUID(), key: "ZZ-701", counted: "1" }] }, // gone
    { added: [{ serial: "zz-701 ", description: "Fake", balance: "1" }] }, // exists already (case / spaces)
    { added: [{ serial: "ZZ702", description: "Fake", balance: "1" }] }, // "ZZ 702" without its space
  ];
  for (const c of cases) assert.equal((await apply(db, ids.inventory, c)).status, "stale", JSON.stringify(c));
  // archived meanwhile
  await as(db, ids.inventory, (tx) => rpc(tx, "inv_set_product_active", { p_product_id: b, p_active: false }));
  assert.equal((await apply(db, ids.inventory, { counts: [{ id: b, key: "ZZ702", counted: "1" }] })).status, "stale");
  assert.equal((await apply(db, ids.inventory, { counts: [{ id: a, key: "ZZ-701", counted: "1" }], archive: [b] })).status, "stale");
  // bad numbers, duplicates, too long: invalid, nothing written
  for (const c of [
    { counts: [{ id: a, key: "ZZ-701", counted: "-1" }] },
    { counts: [{ id: a, key: "ZZ-701", counted: "1.2345" }] },
    { counts: [{ id: a, key: "ZZ-701", counted: "1" }, { id: a, key: "ZZ-701", counted: "2" }] },
    { added: [{ serial: "ZZ-800", description: "", balance: "1" }] },
    { added: [{ serial: "ZZ-800", description: "A", balance: "1" }, { serial: "zz-800", description: "B", balance: "1" }] },
    { added: [{ serial: "ZZ-800", description: "A", balance: "1", rate: "1.234" }] },
  ]) assert.equal((await apply(db, ids.inventory, c)).status, "invalid", JSON.stringify(c));
  assert.equal(await n(db, `select count(*)::int n from public.inv_stock_counts`), before);
  assert.equal(await n(db, `select count(*)::int n from public.inv_import_runs`), 0);
  assert.equal(await n(db, `select count(*)::int n from public.inv_products where serial_no = 'ZZ-800'`), 0);
});

test("November: no balances from a document yet; new products and filled blanks are fine", async () => {
  const { db, ids } = await setup();
  const { a, b } = await store(db, ids);
  const r = await apply(db, ids.inventory, { counts: [{ id: a, key: "ZZ-701", counted: "1" }] });
  assert.equal(r.status, "invalid");
  assert.match(r.message, /from 1 December 2026/);
  const ok = await apply(db, ids.inventory, { added: [{ serial: "ZZ-795", description: "Fake", balance: "2" }], fills: [{ id: b, specification: "1 mm" }] });
  assert.equal(ok.status, "ok", JSON.stringify(ok));
  assert.equal(await n(db, `select count(*)::int n from public.inv_stock_counts`), 0);
});

test("rate limit: 10 imports per 10 minutes per account", async () => {
  const { db, ids } = await setup();
  await store(db, ids);
  for (let i = 0; i < 10; i++) assert.equal((await apply(db, ids.inventory, { added: [{ serial: `ZZ-6${i}0`, description: "Fake", balance: "1" }] })).status, "ok");
  const r = await apply(db, ids.inventory, { added: [{ serial: "ZZ-699", description: "Fake", balance: "1" }] });
  assert.equal(r.status, "rate_limited");
});

test("role matrix (0033) and nothing about the file is stored", async () => {
  const { db, ids } = await setup();
  const { a } = await store(db, ids);
  await setToday(db, "2026-12-02");
  for (const role of ROLES.filter((r) => r !== "inventory")) {
    await denied(apply(db, ids[role], { counts: [{ id: a, key: "ZZ-701", counted: "1" }] }));
    const c = await as(db, ids[role], (tx) => tx.query(`select count(*)::int n from public.inv_import_runs`));
    assert.equal(c.rows[0].n, 0);
  }
  await denied(asUser(db, null, (tx) => rpc(tx, "inv_import_apply", { p_batch_key: "x-12345678", p_counts: "[]", p_new: "[]", p_fills: "[]", p_archive: [], p_rows: 0 }), { role: "anon" }));
  // the run table holds counts only: no file name, no content, no free text at all
  const cols = (await db.query(`select column_name, data_type from information_schema.columns where table_name = 'inv_import_runs' order by ordinal_position`)).rows;
  assert.deepEqual(cols.map((c) => c.column_name), ["id", "batch_key", "rows_in_file", "counted", "adjusted", "added", "filled", "archived", "created_by", "created_at"]);
  assert.equal((await apply(db, ids.inventory, { added: [{ serial: "ZZ-796", description: "Fake", balance: "1" }] })).status, "ok");
  await assert.rejects(db.exec(`update public.inv_import_runs set counted = 0`), /never/);
  await assert.rejects(db.exec(`delete from public.inv_import_runs`), /never/);
  await assert.rejects(db.exec(`truncate public.inv_import_runs`), /never|foreign key/);
});

test("supabase/scripts/0033_verify.sql: every check is ok right after the migration", async () => {
  const { db } = await setup();
  const rows = (await db.query(readFileSync(join(REPO, "supabase/scripts/0033_verify.sql"), "utf8").replace(/^--.*$/gm, ""))).rows;
  assert.ok(rows.length >= 6);
  for (const r of rows) assert.equal(r.ok, true, r.check);
});

test("backup + restore with an import: runs come back before the stock counts that point at them", async () => {
  const { TABLES, restoreSql } = await import("../../scripts/inventory/backup.mjs");
  const { db, ids } = await setup();
  const { a } = await store(db, ids);
  await setToday(db, "2026-12-02");
  assert.equal((await apply(db, ids.inventory, { counts: [{ id: a, key: "ZZ-701", counted: "9" }] })).status, "ok");
  const take = async (d) => {
    const out = { format: 1, taken_at: "x", taken_ist: "x", project_ref: "test", tables: {} };
    for (const t of TABLES) {
      const r = await d.query(`select coalesce(jsonb_agg(to_jsonb(x) order by ${t.order}), '[]'::jsonb) as rows from public.${t.name} x`);
      out.tables[t.name] = { count: r.rows[0].rows.length, rows: r.rows[0].rows };
    }
    return out;
  };
  const backup = await take(db);
  const fresh = await setup();
  await setToday(fresh.db, "2026-12-02");
  await fresh.db.exec(restoreSql(backup));
  const after = await take(fresh.db);
  for (const t of ["inv_import_runs", "inv_stock_counts", "inv_products"]) assert.deepEqual(after.tables[t].rows, backup.tables[t].rows, t);
});
