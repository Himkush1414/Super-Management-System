// Policy + ledger tests for the Inventory migrations (0027, 0028), run
// against a real Postgres 17 in-process (PGlite): every migration in the repo
// is applied to an empty database with a small Supabase-like shim, then the
// role matrix and the ledger rules are exercised exactly the way PostgREST
// calls them (session user `authenticator`, role `authenticated`, JWT claims).
// No real database is involved, and nothing here holds real data.
//
//   npm test   (or only these: node --test tests/sql/*.test.mjs)
//
// (Not part of `npm test`, so the website gets no new dependency.)
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeDb, asUser, applyFile, migrationFiles } from "./harness.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ROLES = ["head_admin", "admin", "marketing", "production", "dispatcher", "inventory"];
const INV_TABLES = ["inv_columns", "inv_products", "inv_transactions", "inv_month_snapshots",
  "inv_closed_months", "inv_settings", "inv_product_log"];

async function setup() {
  const db = await makeDb(REPO);
  const ids = {};
  for (const role of ROLES) {
    const id = randomUUID();
    ids[role] = id;
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
      [id, `test-${role}@example.invalid`, JSON.stringify({ username: `test_${role}`, full_name: `Test ${role}`, role })],
    );
    await db.query(`update public.profiles set role = $2::user_role where id = $1`, [id, role]);
  }
  return { db, ids };
}

/** Freeze "today" (IST) for the ledger: only inv_today() reads the clock. */
async function setToday(db, iso) {
  await db.exec(`create or replace function public.inv_today() returns date language sql stable
                 set search_path = public as $$ select '${iso}'::date $$;`);
}

const rpc = (tx, fn, args = {}) => {
  const names = Object.keys(args);
  const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`;
  return tx.query(sql, Object.values(args)).then((x) => x.rows[0].r);
};
const as = (db, id, fn) => asUser(db, id, fn);
const denied = (p) => assert.rejects(p, (e) => /not permitted|permission denied/.test(e.message));

async function addProduct(db, ids, serial, opening = "0", rate = "10.50") {
  const r = await as(db, ids.inventory, (tx) =>
    rpc(tx, "inv_add_product", { p_serial_no: serial, p_description: `Dummy ${serial}`, p_specification: "Sample",
      p_rate: rate, p_opening_qty: opening, p_custom: "{}" }));
  assert.equal(r.status, "ok", JSON.stringify(r));
  return r.id;
}
const record = (db, ids, product, kind, qty, date, key = randomUUID()) =>
  as(db, ids.inventory, (tx) => rpc(tx, "inv_record_transaction", {
    p_product_id: product, p_kind: kind, p_qty: qty, p_entry_date: date, p_note: null, p_idempotency_key: key }));
const overview = (db, id, month = null) => as(db, id, (tx) => rpc(tx, "inv_overview", { p_month: month }));
const row = (ov, id) => ov.products.find((p) => p.id === id);
const n = (s) => Number(s);

test("0027 only widens user_role; 0027 + 0028 are idempotent", async () => {
  const { db } = await setup();
  const labels = (await db.query(`select enum_range(null::user_role)::text r`)).rows[0].r;
  assert.equal(labels, "{head_admin,admin,marketing,production,dispatcher,inventory}");
  await applyFile(db, REPO, "0027_inventory_role.sql");
  await applyFile(db, REPO, "0028_inventory.sql");
  const cols = (await db.query(`select count(*)::int c from public.inv_columns where is_default`)).rows[0].c;
  assert.equal(cols, 8);
});

/**
 * The ONE delete the owner asked for (2026-11-18): 0032's inv_delete_archived_product
 * permanently deletes an archived product with no history, after copying it into
 * inv_product_tombstones. Its body is checked on its own (exactly these two deletes,
 * keyed to that one product, after the tombstone insert) and left out of the
 * general scan below, which still applies to every other line of every migration.
 */
const DELETE_FN = /create or replace function public\.inv_delete_archived_product\([\s\S]*?\nend \$\$;/;
function withoutTheDeleteFunction(name, code) {
  if (name !== "0032_inventory_archive.sql") return code;
  const fn = DELETE_FN.exec(code)?.[0];
  assert.ok(fn, "0032 has inv_delete_archived_product");
  const deletes = [...fn.matchAll(/\bdelete\s+from\s+[^;]+;/gi)].map((m) => m[0].replace(/\s+/g, " "));
  assert.deepEqual(deletes, [
    "delete from public.inv_product_log where product_id = v_p.id;",
    "delete from public.inv_products where id = v_p.id;",
  ]);
  assert.ok(fn.indexOf("insert into public.inv_product_tombstones") < fn.indexOf("delete from"), "the tombstone is written first");
  assert.match(fn, /inv_has_history\(v_p\.id\)/, "products with history are refused");
  assert.match(fn, /if v_p\.is_active then/, "only archived products");
  return code.replace(fn, "");
}

test("the inventory migrations contain no destructive statement", () => {
  for (const m of migrationFiles(REPO).filter((f) => f.name >= "0027")) {
    const code = withoutTheDeleteFunction(m.name, m.sql.replace(/--.*$/gm, ""));
    assert.doesNotMatch(code, /\bdrop\s+(table|function|policy|type|view|index|trigger|schema|column)\b/i, m.name);
    assert.doesNotMatch(code, /\btruncate\s+(table\s+)?[a-z_.]+\s*;/i, m.name);
    assert.doesNotMatch(code, /\bdelete\s+from\b/i, m.name);
    // ALTER only on the user_role enum (ADD VALUE) and on the new inv_ tables
    for (const [stmt] of code.matchAll(/\balter\s+(table|type)\s+[^;]+/gi)) {
      assert.match(stmt, /alter\s+type\s+public\.user_role\s+add\s+value\s+if\s+not\s+exists\s+'inventory'|alter\s+table\s+public\.inv_/i, stmt);
    }
    // UPDATE only on inv_ tables
    for (const [stmt] of code.matchAll(/\bupdate\s+(public\.)?[a-z_]+\s+set\b/gi)) {
      assert.match(stmt, /update\s+public\.inv_/i, stmt);
    }
  }
});

test("role matrix: who can read and who can write", async () => {
  const { db, ids } = await setup();
  await setToday(db, "2026-11-17");
  const pid = await addProduct(db, ids, "D-001", "5");

  for (const role of ROLES) {
    const canView = ["inventory", "head_admin", "admin"].includes(role);
    // tables: rows only for the three viewing roles (RLS)
    for (const t of INV_TABLES) {
      const c = await as(db, ids[role], (tx) => tx.query(`select count(*)::int c from public.${t}`)).then((r) => r.rows[0].c);
      if (!canView) assert.equal(c, 0, `${role} must not see ${t}`);
    }
    if (canView) {
      const ov = await overview(db, ids[role]);
      assert.equal(ov.products.length, 1, role);
    } else {
      await denied(overview(db, ids[role]));
      await denied(as(db, ids[role], (tx) => rpc(tx, "inv_product_history", { p_product_id: pid })));
      await denied(as(db, ids[role], (tx) => rpc(tx, "inv_range_report", { p_from: "2026-11-01", p_to: "2026-11-17" })));
    }
    // writes: inventory only
    const writes = [
      (tx) => rpc(tx, "inv_record_transaction", { p_product_id: pid, p_kind: "receive", p_qty: "1", p_entry_date: "2026-11-17", p_note: null, p_idempotency_key: randomUUID() }),
      (tx) => rpc(tx, "inv_add_product", { p_serial_no: `X-${role}`, p_description: "x", p_specification: "", p_rate: null, p_opening_qty: "0", p_custom: "{}" }),
      (tx) => rpc(tx, "inv_set_product_active", { p_product_id: pid, p_active: true }),
      (tx) => rpc(tx, "inv_save_settings", { p_person_name: "Someone", p_phone: "" }),
      (tx) => rpc(tx, "inv_add_column", { p_label: `Col ${role}`, p_data_type: "text" }),
    ];
    for (const w of writes) {
      if (role === "inventory") assert.equal((await as(db, ids[role], w)).status, "ok");
      else await denied(as(db, ids[role], w));
    }
    // no direct table writes for anyone signed in, not even inventory
    await denied(as(db, ids[role], (tx) => tx.query(`insert into public.inv_settings (id) values (true)`)));
    await denied(as(db, ids[role], (tx) => tx.query(`update public.inv_products set description = 'x'`)));
    await denied(as(db, ids[role], (tx) => tx.query(`delete from public.inv_transactions`)));
    // the import is service-only
    await denied(as(db, ids[role], (tx) => rpc(tx, "inv_import_products", { p_payload: '{"products":[]}' })));
  }

  // anon: nothing at all
  await denied(asUser(db, null, (tx) => tx.query(`select * from public.inv_products`), { role: "anon" }));
  await denied(asUser(db, null, (tx) => rpc(tx, "inv_overview", { p_month: null }), { role: "anon" }));
});

test("existing tables and accounts are untouched by the inventory migrations", async () => {
  const db = await makeDb(REPO, { upTo: "0024_remove_dispatcher.sql" });
  const uid = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'x@example.invalid', '{"username":"x","full_name":"X","role":"marketing"}')`, [uid]);
  const fp = async () => (await db.query(`
    select md5(string_agg(t, '|' order by t)) f from (
      select 'p:' || concat_ws(',', id, username, role, full_name, real_name) t from public.profiles
      union all select 'u:' || concat_ws(',', id, email, raw_user_meta_data::text) from auth.users
      union all select 'pol:' || concat_ws(',', schemaname, tablename, policyname, qual, with_check) from pg_policies where tablename not like 'inv\\_%'
      union all select 'fn:' || p.oid::regprocedure::text || md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname not like 'inv\\_%'
      union all select 'acl:' || c.relname || coalesce(c.relacl::text, '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname not like 'inv\\_%'
    ) x`)).rows[0].f;
  const before = await fp();
  await applyFile(db, REPO, "0027_inventory_role.sql");
  await applyFile(db, REPO, "0028_inventory.sql");
  assert.equal(await fp(), before);
});

test("ledger: normal flow, zero stock, over-issue, decimals, dates, double submit", async () => {
  const { db, ids } = await setup();
  await setToday(db, "2026-11-17");
  const pid = await addProduct(db, ids, "D-010", "10");

  let r = await record(db, ids, pid, "receive", "5", "2026-11-03");
  assert.deepEqual([r.status, n(r.balance_before), n(r.balance_after)], ["ok", 10, 15]);
  r = await record(db, ids, pid, "issue", "3", "2026-11-17");
  assert.equal(n(r.balance_after), 12);

  let ov = await overview(db, ids.inventory);
  assert.deepEqual([n(row(ov, pid).opening), n(row(ov, pid).received), n(row(ov, pid).issued), n(row(ov, pid).balance)], [10, 5, 3, 12]);

  // over-issue is refused and changes nothing
  r = await record(db, ids, pid, "issue", "12.001", "2026-11-17");
  assert.equal(r.status, "insufficient");
  assert.equal(n(r.balance), 12);
  // down to exactly zero, then nothing more
  assert.equal(n((await record(db, ids, pid, "issue", "12", "2026-11-17")).balance_after), 0);
  assert.equal((await record(db, ids, pid, "issue", "0.001", "2026-11-17")).status, "insufficient");

  // decimal quantities, exactly
  assert.equal((await record(db, ids, pid, "receive", "0.125", "2026-11-17")).balance_after, "0.125");
  assert.equal((await record(db, ids, pid, "receive", "0.1", "2026-11-17")).balance_after, "0.225");
  assert.equal((await record(db, ids, pid, "receive", "0.0001", "2026-11-17")).status, "invalid");
  assert.equal((await record(db, ids, pid, "receive", "0", "2026-11-17")).status, "invalid");
  assert.equal((await record(db, ids, pid, "receive", "-1", "2026-11-17")).status, "invalid");

  // date must be in the current month, not in the future
  assert.equal((await record(db, ids, pid, "receive", "1", "2026-10-31")).status, "invalid");
  assert.equal((await record(db, ids, pid, "receive", "1", "2026-11-18")).status, "invalid");
  assert.equal((await record(db, ids, pid, "receive", "1", "2026-11-01")).status, "ok");

  // double submit: the same key records once
  const key = randomUUID();
  const a = await record(db, ids, pid, "receive", "7", "2026-11-17", key);
  const b = await record(db, ids, pid, "receive", "7", "2026-11-17", key);
  assert.equal(a.status, "ok");
  assert.equal(b.status, "duplicate");
  assert.equal(b.id, a.id);
  const count = (await db.query(`select count(*)::int c from public.inv_transactions where idempotency_key = $1`, [key])).rows[0].c;
  assert.equal(count, 1);
  ov = await overview(db, ids.inventory);
  assert.equal(row(ov, pid).balance, "8.225");
});

test("reverse entry: a new opposite entry, once, this month only", async () => {
  const { db, ids } = await setup();
  await setToday(db, "2026-11-17");
  const pid = await addProduct(db, ids, "D-020", "0");
  const rec = await record(db, ids, pid, "receive", "100", "2026-11-05");
  await record(db, ids, pid, "issue", "30", "2026-11-06");
  const rev = (txId, key = randomUUID()) => as(db, ids.inventory, (tx) =>
    rpc(tx, "inv_reverse_transaction", { p_transaction_id: txId, p_note: null, p_idempotency_key: key }));

  // balance 70: reversing the 100 receipt would go negative
  assert.equal((await rev(rec.id)).status, "insufficient");
  const iss = (await db.query(`select id from public.inv_transactions where product_id = $1 and kind = 'issue'`, [pid])).rows[0].id;
  const r = await rev(iss);
  assert.deepEqual([r.status, n(r.balance_after)], ["ok", 100]);
  let ov = await overview(db, ids.inventory);
  // the reversal nets out of the Issue column, it is not counted as a receipt
  assert.deepEqual([n(row(ov, pid).received), n(row(ov, pid).issued), n(row(ov, pid).balance)], [100, 0, 100]);
  assert.equal((await rev(iss)).status, "invalid"); // already reversed
  assert.equal((await rev(r.id)).status, "invalid"); // a reversal can't be reversed
  // the original stays in the ledger
  const all = (await db.query(`select count(*)::int c from public.inv_transactions where product_id = $1`, [pid])).rows[0].c;
  assert.equal(all, 3);
  // history shows it as reversed
  const h = await as(db, ids.admin, (tx) => rpc(tx, "inv_product_history", { p_product_id: pid }));
  const orig = h.entries.find((e) => e.id === iss);
  assert.equal(orig.reversed_by, r.id);
  assert.equal(orig.reversible, false);

  // next month: last month's entries can't be reversed any more
  await setToday(db, "2026-12-02");
  assert.equal((await rev(rec.id)).status, "invalid");
  ov = await overview(db, ids.inventory);
  assert.equal(n(row(ov, pid).opening), 100);
});

test("month rollover: opening = previous closing, gaps of several months, idempotent", async () => {
  const { db, ids } = await setup();
  await setToday(db, "2026-09-10");
  const pid = await addProduct(db, ids, "D-030", "50");
  await record(db, ids, pid, "receive", "20", "2026-09-10");
  await record(db, ids, pid, "issue", "5.5", "2026-09-10");

  // one month later
  await setToday(db, "2026-10-01");
  let ov = await overview(db, ids.inventory);
  assert.deepEqual([n(row(ov, pid).opening), n(row(ov, pid).received), n(row(ov, pid).balance)], [64.5, 0, 64.5]);
  assert.deepEqual(ov.months, ["2026-09-01"]);
  await record(db, ids, pid, "issue", "4.5", "2026-10-01");

  // three months with nobody opening the module: Oct, Nov, Dec all closed in order
  await setToday(db, "2027-01-15");
  ov = await overview(db, ids.admin);
  assert.deepEqual(ov.months, ["2026-12-01", "2026-11-01", "2026-10-01", "2026-09-01"]);
  const snaps = (await db.query(`select month::text m, opening::float8 o, received::float8 r, issued::float8 i, closing::float8 c
                                   from public.inv_month_snapshots where product_id = $1 order by month`, [pid])).rows;
  assert.deepEqual(snaps.map((s) => [s.m, s.o, s.r, s.i, s.c]), [
    ["2026-09-01", 50, 20, 5.5, 64.5],
    ["2026-10-01", 64.5, 0, 4.5, 60],
    ["2026-11-01", 60, 0, 0, 60],
    ["2026-12-01", 60, 0, 0, 60],
  ]);
  for (let i = 1; i < snaps.length; i++) assert.equal(snaps[i].o, snaps[i - 1].c);
  assert.equal(n(row(ov, pid).opening), 60);

  // idempotent: running again adds nothing
  const before = (await db.query(`select count(*)::int c from public.inv_month_snapshots`)).rows[0].c;
  await overview(db, ids.inventory);
  assert.equal((await as(db, ids.inventory, (tx) => rpc(tx, "inv_rollover"))), 0);
  assert.equal((await db.query(`select count(*)::int c from public.inv_month_snapshots`)).rows[0].c, before);

  // a closed month can be viewed from its snapshot
  const oct = await overview(db, ids.admin, "2026-10-01");
  assert.equal(oct.is_current, false);
  assert.deepEqual([n(row(oct, pid).opening), n(row(oct, pid).issued), n(row(oct, pid).balance)], [64.5, 4.5, 60]);
  // the trend covers 6 months ending at the viewed month
  assert.equal(ov.trend.length, 6);
});

test("range report: opening before the start, sums inside, closing at the end", async () => {
  const { db, ids } = await setup();
  await setToday(db, "2026-11-05");
  const pid = await addProduct(db, ids, "D-040", "10");
  await record(db, ids, pid, "receive", "4", "2026-11-02");
  await record(db, ids, pid, "issue", "1", "2026-11-04");
  await record(db, ids, pid, "issue", "2", "2026-11-05");
  const rep = await as(db, ids.admin, (tx) => rpc(tx, "inv_range_report", { p_from: "2026-11-03", p_to: "2026-11-04" }));
  const p = rep.products[0];
  assert.deepEqual([n(p.opening), n(p.received), n(p.issued), n(p.balance)], [14, 0, 1, 13]);
});

test("append-only: no update, delete or truncate, even for the database owner", async () => {
  const { db, ids } = await setup();
  await setToday(db, "2026-11-17");
  const pid = await addProduct(db, ids, "D-050", "1");
  await record(db, ids, pid, "receive", "1", "2026-11-17");
  const refuses = (sql) => assert.rejects(db.exec(sql), /never/);
  await refuses(`update public.inv_transactions set qty = 2`);
  await refuses(`delete from public.inv_transactions`);
  await refuses(`truncate public.inv_transactions`);
  await refuses(`delete from public.inv_products`);
  await refuses(`truncate public.inv_products cascade`);
  await refuses(`update public.inv_products set opening_qty = 99`);
  await refuses(`delete from public.inv_columns`);
  await refuses(`delete from public.inv_product_log`);
  await assert.rejects(db.exec(`update public.inv_columns set label = 'X' where key = 'rate'`), /cannot be changed/);
});

test("products and custom columns: duplicate serials, archive, locked defaults", async () => {
  const { db, ids } = await setup();
  await setToday(db, "2026-11-17");
  const pid = await addProduct(db, ids, "D-060", "3");
  const inv = (fn, args) => as(db, ids.inventory, (tx) => rpc(tx, fn, args));
  const dup = await inv("inv_add_product", { p_serial_no: "  d-060 ", p_description: "x", p_specification: "", p_rate: null, p_opening_qty: "0", p_custom: "{}" });
  assert.equal(dup.status, "duplicate");

  const col = await inv("inv_add_column", { p_label: "Make", p_data_type: "text" });
  assert.equal(col.status, "ok");
  assert.equal((await inv("inv_add_column", { p_label: "make", p_data_type: "text" })).status, "duplicate");
  const num = await inv("inv_add_column", { p_label: "Weight", p_data_type: "number" });
  assert.equal((await inv("inv_update_product", { p_product_id: pid, p_description: "Dummy", p_specification: "", p_rate: "1",
    p_custom: JSON.stringify({ [num.id]: "abc" }) })).status, "invalid");
  assert.equal((await inv("inv_update_product", { p_product_id: pid, p_description: "Dummy", p_specification: "", p_rate: "1",
    p_custom: JSON.stringify({ [col.id]: "Acme", [num.id]: "2.5" }) })).status, "ok");
  assert.equal((await inv("inv_reorder_columns", { p_column_ids: `{${num.id},${col.id}}` })).status, "ok");
  assert.equal((await inv("inv_update_column", { p_column_id: col.id, p_label: "Brand", p_visible: false })).status, "ok");
  assert.equal((await inv("inv_set_column_archived", { p_column_id: col.id, p_archived: true })).status, "ok");

  // archiving a column keeps the values
  const custom = (await db.query(`select custom from public.inv_products where id = $1`, [pid])).rows[0].custom;
  assert.equal(custom[col.id], "Acme");
  // and editing the product later doesn't drop them
  await inv("inv_update_product", { p_product_id: pid, p_description: "Dummy", p_specification: "", p_rate: "1", p_custom: "{}" });
  assert.equal((await db.query(`select custom from public.inv_products where id = $1`, [pid])).rows[0].custom[col.id], "Acme");

  // default columns are locked
  const rate = (await db.query(`select id from public.inv_columns where key = 'rate'`)).rows[0].id;
  assert.equal((await inv("inv_update_column", { p_column_id: rate, p_label: "Price", p_visible: null })).status, "invalid");
  assert.equal((await inv("inv_set_column_archived", { p_column_id: rate, p_archived: true })).status, "invalid");
  assert.equal((await inv("inv_reorder_columns", { p_column_ids: `{${rate}}` })).status, "invalid");

  // archive a product: still in the ledger and the log, issue refused
  assert.equal((await inv("inv_set_product_active", { p_product_id: pid, p_active: false })).status, "ok");
  assert.equal((await record(db, ids, pid, "receive", "1", "2026-11-17")).status, "archived");
  const log = (await db.query(`select string_agg(action, ',' order by id) a from public.inv_product_log where product_id = $1`, [pid])).rows[0].a;
  assert.equal(log, "create,update,update,archive"); // the second edit cleared Weight
  assert.equal((await inv("inv_set_product_active", { p_product_id: pid, p_active: true })).status, "ok");
});

test("import: upsert on serial, idempotent, atomic", async () => {
  const { db, ids } = await setup();
  await setToday(db, "2026-11-17");
  const payload = {
    columns: [{ label: "UOM", data_type: "text" }],
    products: [
      { serial_no: "S-001", description: "Dummy item one", specification: "M8", rate: "3.50", opening_qty: "100",
        custom: { UOM: "Nos." }, expected_balance: "90",
        movements: [{ kind: "receive", qty: "10", slot: 1 }, { kind: "issue", qty: "20", slot: 1 }] },
      { serial_no: "S-002", description: "Dummy item two", specification: "1 mm", rate: "12", opening_qty: "0.5", custom: {}, movements: [] },
    ],
  };
  const imp = (p) => db.query(`select public.inv_import_products($1::jsonb) r`, [JSON.stringify(p)]).then((x) => x.rows[0].r);
  const first = await imp(payload);
  assert.deepEqual(first, { inserted: 2, updated: 0, unchanged: 0, movements_inserted: 2, movements_skipped: 0, columns_created: 1 });
  const again = await imp(payload);
  assert.deepEqual(again, { inserted: 0, updated: 0, unchanged: 2, movements_inserted: 0, movements_skipped: 2, columns_created: 0 });
  const ov = await overview(db, ids.inventory);
  const s1 = ov.products.find((p) => p.serial_no === "S-001");
  assert.deepEqual([n(s1.opening), n(s1.received), n(s1.issued), n(s1.balance)], [100, 10, 20, 90]);

  // a mismatching row aborts the whole import
  const bad = { products: [
    { serial_no: "S-003", description: "Dummy", opening_qty: "1", movements: [] },
    { serial_no: "S-004", description: "Dummy", opening_qty: "1", expected_balance: "2", movements: [] },
  ] };
  await assert.rejects(imp(bad), /does not match/);
  assert.equal((await db.query(`select count(*)::int c from public.inv_products`)).rows[0].c, 2);
});

// ── 0029: the compact page payload must carry exactly inv_overview's figures ──
const pageRows = (p) => p.rows.map((r) => Object.fromEntries(p.fields.map((f, i) => [f, r[i]])));
const num = (s) => (s === null ? null : Number(s));

test("inv_page = inv_overview: same products, same figures (current and closed month)", async () => {
  const { db, ids } = await setup();
  await setToday(db, "2026-10-05");
  const a = await addProduct(db, ids, "D-070", "12.5", "3.50");
  const b = await addProduct(db, ids, "D-071", "0", null);
  await record(db, ids, a, "receive", "7.125", "2026-10-05");
  const iss = await record(db, ids, a, "issue", "2", "2026-10-05");
  await as(db, ids.inventory, (tx) => rpc(tx, "inv_reverse_transaction", { p_transaction_id: iss.id, p_note: null, p_idempotency_key: randomUUID() }));
  await record(db, ids, b, "receive", "1", "2026-10-05");
  await setToday(db, "2026-11-17");
  await record(db, ids, a, "issue", "0.125", "2026-11-17");

  for (const month of [null, "2026-10-01"]) {
    for (const role of ["inventory", "admin", "head_admin"]) {
      const ov = await overview(db, ids[role], month);
      // everyone asks; only the admin tier gets the trend / top 10
      const pg = await as(db, ids[role], (tx) => rpc(tx, "inv_page", { p_month: month, p_analytics: true }));
      assert.equal(pg.month, ov.month);
      assert.equal(pg.is_current, ov.is_current);
      const rows = pageRows(pg);
      assert.equal(rows.length, ov.products.length);
      for (const p of ov.products) {
        const r = rows.find((x) => x.id === p.id);
        for (const f of ["opening", "received", "issued", "balance", "rate"]) assert.equal(num(r[f]), num(p[f]), `${role} ${month} ${p.serial_no} ${f}`);
        assert.equal(r.serial_no, p.serial_no);
        assert.deepEqual(r.custom, p.custom);
      }
      if (role === "inventory") {
        assert.equal(pg.trend, null);
        assert.equal(pg.top_issued, null);
      } else {
        assert.deepEqual(pg.trend.map((t) => [t.month.slice(0, 10), num(t.received), num(t.issued)]), ov.trend.map((t) => [t.month.slice(0, 10), num(t.received), num(t.issued)]));
        assert.deepEqual(pg.top_issued.map((t) => [t.id, num(t.issued)]), ov.top_issued.map((t) => [t.id, num(t.issued)]));
      }
      assert.ok(pg.ledger_seq >= 1);
    }
  }
  // numbers carry no trailing zeros (smaller payload), still exact
  const cur = pageRows(await as(db, ids.inventory, (tx) => rpc(tx, "inv_page", { p_month: null, p_analytics: false })));
  assert.equal(cur.find((r) => r.serial_no === "D-070").balance, "19.5"); // 12.5 + 7.125 − 2 + 2 (reversed) − 0.125
  assert.equal(cur.find((r) => r.serial_no === "D-070").rate, "3.5");
});

test("inv_page: marketing, production, dispatcher and anon are refused", async () => {
  const { db, ids } = await setup();
  for (const role of ["marketing", "production", "dispatcher"]) {
    await denied(as(db, ids[role], (tx) => rpc(tx, "inv_page", { p_month: null, p_analytics: true })));
  }
  await denied(asUser(db, null, (tx) => rpc(tx, "inv_page", { p_month: null, p_analytics: false }), { role: "anon" }));
});
