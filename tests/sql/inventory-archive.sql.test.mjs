// The Archive tab (0032): list, restore one or many, and the permanent delete of
// an archived product with NO history, enforced by the database (tombstone first).
// PGlite (Postgres 17, in-process), fake data only.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
const inv = (db, ids, fn, args) => as(db, ids.inventory, (tx) => rpc(tx, fn, args));
const denied = (p) => assert.rejects(p, (e) => /not permitted|permission denied/.test(e.message));

async function add(db, ids, serial, opening = "0") {
  const r = await inv(db, ids, "inv_add_product", { p_serial_no: serial, p_description: `Dummy ${serial}`, p_specification: "Sample",
    p_rate: "1.00", p_opening_qty: opening, p_custom: "{}" });
  assert.equal(r.status, "ok", JSON.stringify(r));
  return r.id;
}
const archive = (db, ids, id) => inv(db, ids, "inv_set_product_active", { p_product_id: id, p_active: false });
const list = (db, id) => as(db, id, (tx) => rpc(tx, "inv_archive_list"));
const rowsOf = (l) => Object.fromEntries(l.rows.map((r) => [r[1], Object.fromEntries(l.fields.map((f, i) => [f, r[i]]))]));
const del = (db, ids, id, serial) => inv(db, ids, "inv_delete_archived_product", { p_product_id: id, p_confirm_serial: serial });
const count = async (db, sql, args = []) => (await db.query(sql, args)).rows[0].n;

/** Nov: four products; one has entries, one is archived without history, one archived with history. */
async function store(db, ids) {
  await setToday(db, "2026-11-17");
  const used = await add(db, ids, "ZZ-801", "5");
  const mistake = await add(db, ids, "ZZ-802", "3");
  const other = await add(db, ids, "ZZ-803", "1");
  const plain = await add(db, ids, "ZZ-804", "0");
  const r = await inv(db, ids, "inv_record_entry", { p_product_id: used, p_kind: "issue", p_qty: "2", p_entry_date: "2026-11-17", p_note: null, p_idempotency_key: randomUUID() });
  assert.equal(r.status, "ok");
  for (const p of [used, mistake]) assert.equal((await archive(db, ids, p)).status, "ok");
  return { used, mistake, other, plain };
}

test("Archive list: archived products with archived date, last balance and whether they have history", async () => {
  const { db, ids } = await setup();
  const { used, mistake } = await store(db, ids);
  for (const role of ["inventory", "admin", "head_admin"]) {
    const l = rowsOf(await list(db, ids[role]));
    assert.deepEqual(Object.keys(l).sort(), ["ZZ-801", "ZZ-802"], role);
    assert.equal(l["ZZ-801"].balance, "3");
    assert.equal(l["ZZ-801"].has_history, true);
    assert.equal(l["ZZ-801"].entries, 1);
    assert.equal(l["ZZ-802"].has_history, false);
    assert.ok(l["ZZ-802"].archived_at);
  }
  for (const role of ["marketing", "production", "dispatcher"]) await denied(list(db, ids[role]));
  await denied(asUser(db, null, (tx) => rpc(tx, "inv_archive_list"), { role: "anon" }));
  void used; void mistake;
});

test("restore: one or many, the ledger and balances untouched; pending only if it existed before the month", async () => {
  const { db, ids } = await setup();
  const { used, mistake, other } = await store(db, ids);
  const page = async () => (await as(db, ids.admin, (tx) => rpc(tx, "inv_page3", { p_month: null, p_analytics: false })));
  const ledgerBefore = await db.query(`select * from public.inv_transactions order by id`);
  const balancesBefore = (await page()).rows.map((r) => [r[1], r[10]]);
  await setToday(db, "2026-12-03");
  // a product added in December, archived, restored: confirmed
  const dec = await add(db, ids, "ZZ-805", "4");
  await archive(db, ids, dec);
  const r = await inv(db, ids, "inv_restore_products", { p_product_ids: [used, mistake, dec, other, randomUUID()] });
  assert.deepEqual(r, { status: "ok", restored: 3, already_active: 1, not_found: 1 });
  assert.deepEqual((await db.query(`select * from public.inv_transactions order by id`)).rows, ledgerBefore.rows, "ledger untouched");
  const pg = await page();
  const byS = Object.fromEntries(pg.rows.map((x) => [x[1], { bal: x[10], active: x[6], pending: x[15] }]));
  for (const [s, b] of balancesBefore) assert.equal(byS[s].bal, b, `${s} balance unchanged`);
  assert.equal(byS["ZZ-801"].active, true);
  assert.equal(byS["ZZ-801"].pending, true, "existed before December, no count yet: pending");
  assert.equal(byS["ZZ-805"].pending, false, "added in December: confirmed");
  assert.equal(await count(db, `select count(*)::int n from public.inv_product_log where action = 'restore'`), 3);
  assert.equal(rowsOf(await list(db, ids.inventory))["ZZ-801"], undefined);
  // twice: nothing more
  const again = await inv(db, ids, "inv_restore_products", { p_product_ids: [used] });
  assert.deepEqual(again, { status: "ok", restored: 0, already_active: 1, not_found: 0 });
  assert.equal((await inv(db, ids, "inv_restore_products", { p_product_ids: [] })).status, "invalid");
});

test("delete: only an archived product with zero history, the serial typed, tombstone first", async () => {
  const { db, ids } = await setup();
  const { used, mistake, other } = await store(db, ids);
  const before = await count(db, `select count(*)::int n from public.inv_products`);
  // refused: wrong serial, active product, product with history
  assert.equal((await del(db, ids, mistake, "ZZ-80")).status, "invalid");
  assert.equal((await del(db, ids, other, "ZZ-803")).status, "active");
  const h = await del(db, ids, used, "ZZ-801");
  assert.equal(h.status, "has_history");
  assert.equal(h.message, "Has history, can only be restored.");
  assert.equal(await count(db, `select count(*)::int n from public.inv_products`), before, "nothing deleted");
  assert.equal(await count(db, `select count(*)::int n from public.inv_product_tombstones`), 0);
  // allowed: archived, no history; the serial in any case / with spaces
  const snap = (await db.query(`select to_jsonb(p) j from public.inv_products p where id = $1`, [mistake])).rows[0].j;
  const logs = (await db.query(`select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]') j from public.inv_product_log l where product_id = $1`, [mistake])).rows[0].j;
  const ok = await del(db, ids, mistake, "  zz-802 ");
  assert.equal(ok.status, "ok", JSON.stringify(ok));
  assert.equal(await count(db, `select count(*)::int n from public.inv_products where id = $1`, [mistake]), 0);
  assert.equal(await count(db, `select count(*)::int n from public.inv_product_log where product_id = $1`, [mistake]), 0);
  const t = (await db.query(`select * from public.inv_product_tombstones`)).rows;
  assert.equal(t.length, 1);
  assert.deepEqual(t[0].product, snap, "the whole row is in the tombstone");
  assert.deepEqual(t[0].product_log, logs, "its detail-change log too");
  assert.equal(t[0].deleted_by, ids.inventory);
  assert.equal(await count(db, `select count(*)::int n from public.inv_products`), before - 1);
  // a second tap: the product is gone
  assert.equal((await del(db, ids, mistake, "ZZ-802")).status, "not_found");
  // the serial is free again
  await add(db, ids, "ZZ-802", "1");
  // the tombstone is append-only
  await assert.rejects(db.exec(`update public.inv_product_tombstones set serial_no = 'x'`), /never/);
  await assert.rejects(db.exec(`delete from public.inv_product_tombstones`), /never/);
  await assert.rejects(db.exec(`truncate public.inv_product_tombstones`), /never/);
});

test("delete: a stock count or a closed month is history too", async () => {
  const { db, ids } = await setup();
  await setToday(db, "2026-11-17");
  const a = await add(db, ids, "ZZ-811", "2");
  const b = await add(db, ids, "ZZ-812", "0");
  await setToday(db, "2026-12-01");
  assert.equal((await inv(db, ids, "inv_record_stock_count", { p_product_id: a, p_counted: "2", p_note: null, p_idempotency_key: randomUUID() })).status, "ok");
  await as(db, ids.inventory, (tx) => rpc(tx, "inv_rollover2")); // November closed: b has a snapshot row
  for (const p of [a, b]) await archive(db, ids, p);
  assert.equal((await del(db, ids, a, "ZZ-811")).status, "has_history");
  assert.equal((await del(db, ids, b, "ZZ-812")).status, "has_history");
  const l = rowsOf(await list(db, ids.inventory));
  assert.equal(l["ZZ-811"].has_history, true);
  assert.equal(l["ZZ-812"].has_history, true);
});

test("the database refuses every other delete, with or without the app", async () => {
  const { db, ids } = await setup();
  const { mistake, other } = await store(db, ids);
  // the owner deleting directly: refused exactly as before 0032
  await assert.rejects(db.exec(`delete from public.inv_products where id = '${mistake}'`), /never deleted \(inv_products\)/);
  await assert.rejects(db.exec(`delete from public.inv_product_log where product_id = '${mistake}'`), /never deleted \(inv_product_log\)/);
  await assert.rejects(db.exec(`update public.inv_product_log set action = 'update'`), /never edited/);
  await assert.rejects(db.exec(`truncate public.inv_products`), /never|foreign key/);
  await assert.rejects(db.exec(`truncate public.inv_product_log`), /never/);
  // a tombstone written in ANOTHER transaction opens nothing
  await db.query(`insert into public.inv_product_tombstones (product_id, serial_no, product) values ($1, 'x', '{}')`, [mistake]);
  await assert.rejects(db.exec(`delete from public.inv_products where id = '${mistake}'`), /never deleted/);
  // inside one transaction, a tombstone for one product doesn't open another's rows
  await assert.rejects(db.transaction(async (tx) => {
    await tx.query(`insert into public.inv_product_tombstones (product_id, serial_no, product) values ($1, 'x', '{}')`, [mistake]);
    await tx.query(`delete from public.inv_product_log where product_id = $1`, [other]);
  }), /never deleted/);
  // signed-in accounts have no DELETE right at all
  for (const role of ROLES) {
    await assert.rejects(as(db, ids[role], (tx) => tx.query(`delete from public.inv_products where id = $1`, [mistake])), /permission denied|never/);
  }
});

test("role matrix (0032): only inventory restores and deletes; the admin tier reads; others nothing", async () => {
  const { db, ids } = await setup();
  const { mistake } = await store(db, ids);
  for (const role of ROLES.filter((r) => r !== "inventory")) {
    await denied(as(db, ids[role], (tx) => rpc(tx, "inv_restore_products", { p_product_ids: [mistake] })));
    await denied(as(db, ids[role], (tx) => rpc(tx, "inv_delete_archived_product", { p_product_id: mistake, p_confirm_serial: "ZZ-802" })));
    const c = await as(db, ids[role], (tx) => tx.query(`select count(*)::int n from public.inv_product_tombstones`));
    if (!["head_admin", "admin"].includes(role)) assert.equal(c.rows[0].n, 0, role);
  }
  for (const sql of [`select public.inv_has_history('${mistake}')`, `select public.inv_tombstoned_now('${mistake}')`]) {
    for (const role of ROLES) await denied(as(db, ids[role], (tx) => tx.query(sql)));
  }
  assert.equal(await count(db, `select count(*)::int n from public.inv_products where id = $1`, [mistake]), 1, "still there");
});

test("supabase/scripts/0032_verify.sql: every check is ok right after the migration", async () => {
  const { readFileSync } = await import("node:fs");
  const { db } = await setup();
  const rows = (await db.query(readFileSync(join(REPO, "supabase/scripts/0032_verify.sql"), "utf8").replace(/^--.*$/gm, ""))).rows;
  assert.ok(rows.length >= 8);
  for (const r of rows) assert.equal(r.ok, true, r.check);
});

test("delete: a product that lived through an ended month is history even before anyone opened the new month", async () => {
  const { db, ids } = await setup();
  await setToday(db, "2026-11-17");
  const p = await add(db, ids, "ZZ-821", "3");
  await archive(db, ids, p);
  await setToday(db, "2026-12-02"); // nobody has opened Inventory in December yet
  assert.equal(await count(db, `select count(*)::int n from public.inv_month_snapshots`), 0);
  // the delete closes November first: the product has a November snapshot, so it stays
  assert.equal((await del(db, ids, p, "ZZ-821")).status, "has_history");
  assert.equal(await count(db, `select count(*)::int n from public.inv_month_snapshots where product_id = $1`, [p]), 1);
  assert.equal(rowsOf(await list(db, ids.admin))["ZZ-821"].has_history, true);
  // November's figures still include it
  const nov = await as(db, ids.admin, (tx) => rpc(tx, "inv_page3", { p_month: "2026-11-01", p_analytics: false }));
  assert.ok(nov.rows.some((r) => r[1] === "ZZ-821"));
});
