// Month-start balance (0031): the 1 December rollover with a fake clock,
// pending → confirmed, the adjustment identity, the old functions still
// working, and the role matrix. PGlite (Postgres 17, in-process), fake data
// only — no real database is involved.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeDb, asUser } from "./harness.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ROLES = ["head_admin", "admin", "marketing", "production", "dispatcher", "inventory"];

async function setup({ countsFrom = "2026-12-01", migrations } = {}) {
  const db = await makeDb(REPO, migrations);
  const ids = {};
  for (const role of ROLES) {
    const id = randomUUID();
    ids[role] = id;
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
      [id, `test-${role}@example.invalid`, JSON.stringify({ username: `test_${role}`, full_name: `Test ${role}`, role })]);
    await db.query(`update public.profiles set role = $2::user_role where id = $1`, [id, role]);
  }
  // the migration sets "next month" from the real clock: pin it for the tests
  if (countsFrom) await db.query(`update public.inv_count_settings set counts_from = $1::date`, [countsFrom]);
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
const N = (s) => Number(s);

async function addProduct(db, ids, serial, opening = "0", rate = "10.50") {
  const r = await as(db, ids.inventory, (tx) => rpc(tx, "inv_add_product", {
    p_serial_no: serial, p_description: `Dummy ${serial}`, p_specification: "Sample", p_rate: rate, p_opening_qty: opening, p_custom: "{}" }));
  assert.equal(r.status, "ok", JSON.stringify(r));
  return r.id;
}
const entry = (db, ids, product, kind, qty, date, extra = {}) => as(db, ids.inventory, (tx) => rpc(tx, "inv_record_entry2", {
  p_product_id: product, p_kind: kind, p_qty: qty, p_entry_date: date, p_note: null, p_idempotency_key: randomUUID(), ...extra }));
const count = (db, ids, product, counted, key = randomUUID()) => as(db, ids.inventory, (tx) => rpc(tx, "inv_record_stock_count", {
  p_product_id: product, p_counted: counted, p_note: null, p_idempotency_key: key }));
const page3 = (db, id, month = null) => as(db, id, (tx) => rpc(tx, "inv_page3", { p_month: month, p_analytics: false }));
const page2 = (db, id, month = null) => as(db, id, (tx) => rpc(tx, "inv_page2", { p_month: month, p_analytics: false }));
/** inv_page rows as objects by serial */
const bySerial = (pg) => Object.fromEntries(pg.rows.map((r) => [r[1], Object.fromEntries(pg.fields.map((f, i) => [f, r[i]]))]));

/** November's entries, like live: through the 0030 function (inv_record_entry). */
const oldEntry = (db, ids, product, kind, qty, date) => as(db, ids.inventory, (tx) => rpc(tx, "inv_record_entry", {
  p_product_id: product, p_kind: kind, p_qty: qty, p_entry_date: date, p_note: null, p_idempotency_key: randomUUID() }));

/** A November like live: products added on the 17th, some entries, one archived. */
async function november(db, ids) {
  await setToday(db, "2026-11-17");
  const a = await addProduct(db, ids, "ZZ-901", "10");
  const b = await addProduct(db, ids, "ZZ-902", "4.5");
  const c = await addProduct(db, ids, "ZZ-903", "0");
  const d = await addProduct(db, ids, "ZZ-904", "7");
  await setToday(db, "2026-11-20");
  assert.equal((await oldEntry(db, ids, a, "receive", "5", "2026-11-18")).status, "ok");
  assert.equal((await oldEntry(db, ids, a, "issue", "3", "2026-11-20")).status, "ok");
  assert.equal((await oldEntry(db, ids, b, "issue", "0.5", "2026-11-19")).status, "ok");
  assert.equal((await as(db, ids.inventory, (tx) => rpc(tx, "inv_set_product_active", { p_product_id: d, p_active: false }))).status, "ok");
  return { a, b, c, d };
}

const snapRows = async (db, table) =>
  (await db.query(`select p.serial_no, s.month::text, s.opening::text, s.received::text, s.issued::text, s.closing::text
                     from public.${table} s join public.inv_products p on p.id = s.product_id order by 1, 2`)).rows;

test("1 December: November is closed exactly like inv_rollover; every active product is pending", async () => {
  const { db, ids } = await setup();
  const { a, b, c, d } = await november(db, ids);
  const nov = bySerial(await page2(db, ids.inventory));

  await setToday(db, "2026-12-01");
  const pg = await page3(db, ids.inventory);
  assert.equal(pg.current_month, "2026-12-01");
  assert.deepEqual(pg.months, ["2026-11-01"]);
  // the same rollover on a twin database with the OLD function
  const twin = await setup();
  await november(twin.db, twin.ids);
  await setToday(twin.db, "2026-12-01");
  assert.equal((await as(twin.db, twin.ids.inventory, (tx) => rpc(tx, "inv_rollover"))), 1);
  assert.deepEqual(await snapRows(db, "inv_month_snapshots"), await snapRows(twin.db, "inv_month_snapshots"));
  assert.equal((await db.query(`select count(*)::int n from public.inv_month_snapshots2`)).rows[0].n, 0);
  // November's closing = what the November screen showed as balance
  const novClosed = bySerial(await page3(db, ids.admin, "2026-11-01"));
  for (const s of ["ZZ-901", "ZZ-902", "ZZ-903", "ZZ-904"]) {
    assert.equal(novClosed[s].balance, nov[s].balance, s);
    assert.equal(novClosed[s].adjustment, "0");
    assert.equal(novClosed[s].pending, false);
  }

  const dec = bySerial(pg);
  assert.equal(pg.active_count, 3);
  assert.equal(pg.pending_count, 3);
  for (const s of ["ZZ-901", "ZZ-902", "ZZ-903"]) {
    assert.equal(dec[s].pending, true, s);
    assert.equal(dec[s].opening, nov[s].balance, `${s} opening = November closing`);
    assert.equal(dec[s].adjustment, "0");
  }
  assert.equal(dec["ZZ-904"].pending, false, "archived products are not pending");
  // a product added in December is confirmed when it is added
  const e = await addProduct(db, ids, "ZZ-905", "2");
  const pg2 = await page3(db, ids.inventory);
  assert.equal(bySerial(pg2)["ZZ-905"].pending, false);
  assert.equal(pg2.pending_count, 3);
  void a; void b; void c; void d;
  void e;
});

test("rollover: a second run closes nothing; a gap of several months is closed in order", async () => {
  const { db, ids } = await setup();
  const { a, b } = await november(db, ids);
  await setToday(db, "2026-12-01");
  assert.equal(await as(db, ids.inventory, (tx) => rpc(tx, "inv_rollover2")), 1);
  assert.equal(await as(db, ids.inventory, (tx) => rpc(tx, "inv_rollover2")), 0, "double run");
  assert.equal(await as(db, ids.admin, (tx) => rpc(tx, "inv_rollover2")), 0);

  // December: one counted with a loss, one never counted
  await setToday(db, "2026-12-05");
  const r = await count(db, ids, a, "10");
  assert.equal(r.status, "ok");
  assert.equal(r.adjustment, "-2"); // opening 12, counted 10
  assert.equal(r.month_start, true);
  assert.equal((await entry(db, ids, a, "issue", "4", "2026-12-05")).status, "ok");

  // nobody opens the module until 3 March: December, January, February close at once
  await setToday(db, "2027-03-03");
  assert.equal(await as(db, ids.inventory, (tx) => rpc(tx, "inv_rollover2")), 3);
  assert.equal(await as(db, ids.inventory, (tx) => rpc(tx, "inv_rollover2")), 0);
  const s2 = (await db.query(`select p.serial_no, s.month::text, s.opening::text, s.adjustment::text, s.received::text,
                                     s.issued::text, s.closing::text, s.confirmed
                                from public.inv_month_snapshots2 s join public.inv_products p on p.id = s.product_id
                               where p.id in ($1, $2) order by 1, 2`, [a, b])).rows;
  const t1 = s2.filter((x) => x.serial_no === "ZZ-901");
  assert.deepEqual(t1.map((x) => x.month), ["2026-12-01", "2027-01-01", "2027-02-01"]);
  assert.deepEqual([t1[0].opening, t1[0].adjustment, t1[0].issued, t1[0].closing, t1[0].confirmed], ["12.000", "-2.000", "4.000", "6.000", true]);
  assert.equal(t1[1].opening, "6.000");
  assert.equal(t1[1].confirmed, false, "January was never counted");
  const t2 = s2.filter((x) => x.serial_no === "ZZ-902");
  assert.deepEqual([t2[0].opening, t2[0].closing, t2[0].confirmed], ["4.000", "4.000", false]);
  for (const x of s2) assert.equal(N(x.opening) + N(x.adjustment) + N(x.received) - N(x.issued), N(x.closing));
  const pg = await page3(db, ids.admin);
  assert.deepEqual(pg.months, ["2027-02-01", "2027-01-01", "2026-12-01", "2026-11-01"]);
  assert.equal(bySerial(pg)["ZZ-901"].opening, "6");
  assert.equal(bySerial(pg)["ZZ-901"].pending, true, "pending again in March");
  // a closed month from the new table: adjustment shown, never-counted flagged
  const decView = bySerial(await page3(db, ids.admin, "2026-12-01"));
  assert.equal(decView["ZZ-901"].adjustment, "-2");
  assert.equal(decView["ZZ-901"].balance, "6");
  assert.equal(decView["ZZ-902"].pending, true);
});

test("pending: no entry before the count; count + entry in one atomic save; low stock waits for the count", async () => {
  const { db, ids } = await setup();
  const { a, b, c } = await november(db, ids);
  await as(db, ids.inventory, (tx) => rpc(tx, "inv_set_min_stock", { p_product_id: b, p_min_stock: "100" }));
  await setToday(db, "2026-12-02");
  let pg = await page3(db, ids.inventory);
  assert.equal(pg.low_count, 0, "a pending product is in no alert");

  const refused = await entry(db, ids, a, "receive", "1", "2026-12-02");
  assert.equal(refused.status, "pending");
  assert.equal(refused.opening, "12");
  // issue larger than the counted balance: nothing is written, not even the count
  const tooMuch = await entry(db, ids, a, "issue", "20", "2026-12-02", { p_count: "15", p_count_key: randomUUID() });
  assert.equal(tooMuch.status, "insufficient");
  assert.equal((await db.query(`select count(*)::int n from public.inv_stock_counts`)).rows[0].n, 0);
  // the same sheet: counted 15 (adjustment +3), then issue 5
  const ok = await entry(db, ids, a, "issue", "5", "2026-12-02", { p_count: "15", p_count_key: randomUUID() });
  assert.equal(ok.status, "ok", JSON.stringify(ok));
  assert.equal(ok.adjustment, "3");
  assert.equal(ok.balance_before, "15");
  assert.equal(ok.balance_after, "10");
  // "Same as opening": adjustment 0
  const same = await count(db, ids, c, "0");
  assert.equal(same.status, "ok");
  assert.equal(same.adjustment, "0");

  pg = await page3(db, ids.inventory);
  const rows = bySerial(pg);
  assert.equal(pg.pending_count, 1);
  assert.equal(rows["ZZ-901"].pending, false);
  assert.deepEqual([rows["ZZ-901"].opening, rows["ZZ-901"].adjustment, rows["ZZ-901"].issued, rows["ZZ-901"].balance], ["12", "3", "5", "10"]);
  assert.equal(rows["ZZ-902"].pending, true);
  // ZZ-902 counted below its minimum: now in the alert
  await count(db, ids, b, "4");
  pg = await page3(db, ids.inventory);
  assert.equal(pg.low_count, 1);
  assert.equal(pg.pending_count, 0);
});

test("stock counts: idempotent, append-only, a later count adds a new adjustment; not before counts_from", async () => {
  const { db, ids } = await setup();
  const { a, d } = await november(db, ids);
  // November: counting has not started
  const early = await count(db, ids, a, "1");
  assert.equal(early.status, "invalid");
  assert.match(early.message, /1 December 2026/);
  await setToday(db, "2026-12-01");
  const key = randomUUID();
  const first = await count(db, ids, a, "11.5", key);
  assert.equal(first.status, "ok");
  const again = await count(db, ids, a, "11.5", key);
  assert.equal(again.status, "duplicate");
  assert.equal(again.balance_after, "11.5");
  await setToday(db, "2026-12-15");
  const later = await count(db, ids, a, "11");
  assert.equal(later.status, "ok");
  assert.equal(later.adjustment, "-0.5");
  assert.equal(later.month_start, false);
  const rows = (await db.query(`select entry_date::text, counted::text, balance_before::text, adjustment::text from public.inv_stock_counts order by id`)).rows;
  assert.deepEqual(rows, [
    { entry_date: "2026-12-01", counted: "11.500", balance_before: "12.000", adjustment: "-0.500" },
    { entry_date: "2026-12-15", counted: "11.000", balance_before: "11.500", adjustment: "-0.500" },
  ]);
  await assert.rejects(db.exec(`update public.inv_stock_counts set counted = 1`), /never/);
  await assert.rejects(db.exec(`delete from public.inv_stock_counts`), /never/);
  await assert.rejects(db.exec(`truncate public.inv_stock_counts`), /never/);
  await assert.rejects(db.exec(`truncate public.inv_month_snapshots2`), /never/);
  await assert.rejects(db.exec(`truncate public.inv_closed_months2`), /never/);
  await assert.rejects(db.exec(`delete from public.inv_count_settings`), /never/);
  // bad input, archived product
  for (const bad of ["-1", "1.2345"]) assert.equal((await count(db, ids, a, bad)).status, "invalid", bad);
  assert.equal((await count(db, ids, d, "1")).status, "archived");
  assert.equal((await count(db, ids, randomUUID(), "1")).status, "not_found");
  // history shows the counts
  const h = await as(db, ids.admin, (tx) => rpc(tx, "inv_product_history3", { p_product_id: a }));
  assert.equal(h.counts.length, 2);
  assert.equal(h.counts[0].adjustment, "-0.5");
});

test("exports: Opening + Adjustment + Received − Issued = Closing on every row; pending flagged in the current month", async () => {
  const { db, ids } = await setup();
  const { a, b, c } = await november(db, ids);
  await setToday(db, "2026-12-10");
  await entry(db, ids, a, "receive", "2", "2026-12-03", { p_count: "9", p_count_key: randomUUID() });
  await count(db, ids, c, "1.25");
  const range = (from, to) => as(db, ids.admin, (tx) => rpc(tx, "inv_range_report2", { p_from: from, p_to: to }));
  for (const [from, to] of [["2026-12-01", "2026-12-31"], ["2026-11-01", "2026-12-31"], ["2026-12-02", "2026-12-09"], [null, "2026-12-10"], ["2026-11-01", "2026-11-30"]]) {
    const rep = await range(from, to);
    for (const p of rep.products) {
      assert.equal(N(p.opening) + N(p.adjustment) + N(p.received) - N(p.issued), N(p.balance), `${p.serial_no} ${from}..${to}`);
    }
  }
  const dec = Object.fromEntries((await range("2026-12-01", "2026-12-31")).products.map((p) => [p.serial_no, p]));
  assert.deepEqual([N(dec["ZZ-901"].opening), N(dec["ZZ-901"].adjustment), N(dec["ZZ-901"].received), N(dec["ZZ-901"].balance)], [12, -3, 2, 11]);
  assert.equal(dec["ZZ-901"].pending, false);
  assert.equal(dec["ZZ-902"].pending, true);
  assert.equal(N(dec["ZZ-903"].adjustment), 1.25);
  // November alone: exactly the old report
  const oldNov = await as(db, ids.admin, (tx) => rpc(tx, "inv_range_report", { p_from: "2026-11-01", p_to: "2026-11-30" }));
  const newNov = await range("2026-11-01", "2026-11-30");
  for (const p of oldNov.products) {
    const q = newNov.products.find((x) => x.id === p.id);
    for (const k of ["opening", "received", "issued", "balance"]) assert.equal(N(q[k]), N(p[k]), `${p.serial_no} ${k}`);
    assert.equal(N(q.adjustment), 0);
    assert.equal(q.pending, false, "a past range is never pending");
  }
  void b;
});

test("November is unchanged: inv_page3 = inv_page2 before counting starts", async () => {
  const { db, ids } = await setup();
  await november(db, ids);
  for (const role of ["inventory", "admin", "head_admin"]) {
    const p2 = bySerial(await page2(db, ids[role]));
    const p3 = await page3(db, ids[role]);
    assert.equal(p3.pending_count, 0);
    for (const [s, r] of Object.entries(bySerial(p3))) {
      for (const k of ["opening", "received", "issued", "balance", "min_stock", "is_active"]) assert.deepEqual(r[k], p2[s][k], `${role} ${s} ${k}`);
      assert.equal(r.adjustment, "0");
      assert.equal(r.pending, false);
    }
  }
});

test("the old functions still work; the over-issue rule also holds for them once a count lowered the balance", async () => {
  const { db, ids } = await setup();
  const { a } = await november(db, ids);
  await setToday(db, "2026-12-01");
  assert.equal((await count(db, ids, a, "2")).adjustment, "-10");
  // old inv_record_transaction sees 12 (no adjustment) — the new trigger refuses going below the real 2
  await assert.rejects(as(db, ids.inventory, (tx) => rpc(tx, "inv_record_transaction", {
    p_product_id: a, p_kind: "issue", p_qty: "5", p_entry_date: "2026-12-01", p_note: null, p_idempotency_key: randomUUID() })), /below zero/);
  const small = await as(db, ids.inventory, (tx) => rpc(tx, "inv_record_transaction", {
    p_product_id: a, p_kind: "issue", p_qty: "1", p_entry_date: "2026-12-01", p_note: null, p_idempotency_key: randomUUID() }));
  assert.equal(small.status, "ok");
  const old = await as(db, ids.inventory, (tx) => rpc(tx, "inv_record_entry", {
    p_product_id: a, p_kind: "receive", p_qty: "3", p_entry_date: "2026-12-01", p_note: null, p_idempotency_key: randomUUID() }));
  assert.equal(old.status, "ok");
  // new functions see the real balance: 2 − 1 + 3 = 4
  assert.equal((await entry(db, ids, a, "issue", "5", "2026-12-01")).status, "insufficient");
  const ok = await entry(db, ids, a, "issue", "4", "2026-12-01");
  assert.equal(ok.balance_after, "0");
  // reversal (new version) uses the real balance too
  const rev = await as(db, ids.inventory, (tx) => rpc(tx, "inv_reverse_entry2", { p_transaction_id: ok.id, p_note: null, p_idempotency_key: randomUUID() }));
  assert.equal(rev.status, "ok");
  assert.equal(rev.balance_after, "4");
  // old reads still answer
  for (const fn of ["inv_page", "inv_page2"]) assert.ok((await as(db, ids.admin, (tx) => rpc(tx, fn, { p_month: null, p_analytics: true }))).rows.length > 0, fn);
  assert.ok((await as(db, ids.admin, (tx) => rpc(tx, "inv_overview", { p_month: null }))).products.length > 0);
  assert.ok((await as(db, ids.admin, (tx) => rpc(tx, "inv_product_history2", { p_product_id: a }))).entries.length > 0);
  // double submit of the combined save
  await setToday(db, "2027-01-02");
  const k1 = randomUUID();
  const k2 = randomUUID();
  const args = { p_product_id: a, p_kind: "receive", p_qty: "1", p_entry_date: "2027-01-02", p_note: null, p_idempotency_key: k1, p_count: "4", p_count_key: k2 };
  const [x, y] = await Promise.all([as(db, ids.inventory, (tx) => rpc(tx, "inv_record_entry2", args)), as(db, ids.inventory, (tx) => rpc(tx, "inv_record_entry2", args))]);
  assert.deepEqual([x.status, y.status].sort(), ["duplicate", "ok"]);
  assert.equal((await db.query(`select count(*)::int n from public.inv_stock_counts where idempotency_key = $1`, [k2])).rows[0].n, 1);
});

test("role matrix (0031): inventory writes; admin tier reads; marketing, production, dispatcher and anon get nothing", async () => {
  const { db, ids } = await setup();
  const { a } = await november(db, ids);
  await setToday(db, "2026-12-01");
  for (const role of ROLES) {
    const viewer = ["inventory", "head_admin", "admin"].includes(role);
    if (viewer) {
      assert.equal((await page3(db, ids[role])).pending_count, 3, role);
      await as(db, ids[role], (tx) => rpc(tx, "inv_range_report2", { p_from: "2026-12-01", p_to: "2026-12-31" }));
      await as(db, ids[role], (tx) => rpc(tx, "inv_product_history3", { p_product_id: a }));
    } else {
      await denied(page3(db, ids[role]));
      await denied(as(db, ids[role], (tx) => rpc(tx, "inv_range_report2", { p_from: "2026-12-01", p_to: "2026-12-31" })));
      await denied(as(db, ids[role], (tx) => rpc(tx, "inv_product_history3", { p_product_id: a })));
      await denied(as(db, ids[role], (tx) => rpc(tx, "inv_rollover2")));
      const n = await as(db, ids[role], (tx) => tx.query(`select count(*)::int n from public.inv_live_figures('2026-12-01')`));
      assert.equal(n.rows[0].n, 0, `${role} sees no figures`);
      for (const t of ["inv_stock_counts", "inv_month_snapshots2", "inv_closed_months2", "inv_count_settings"]) {
        const c = await as(db, ids[role], (tx) => tx.query(`select count(*)::int n from public.${t}`));
        assert.equal(c.rows[0].n, 0, `${role} ${t}`);
      }
    }
    if (role !== "inventory") {
      await denied(count(db, { inventory: ids[role] }, a, "1"));
      await denied(as(db, ids[role], (tx) => rpc(tx, "inv_record_entry2", {
        p_product_id: a, p_kind: "receive", p_qty: "1", p_entry_date: "2026-12-01", p_note: null, p_idempotency_key: randomUUID(),
        p_count: "1", p_count_key: randomUUID() })));
    }
    // internal helpers are never callable over the API
    for (const sql of [`select public.inv_balance_now('${a}')`, `select public.inv_is_pending('${a}', '2026-12-01')`,
                       `select public.inv_put_count('${a}', 1, null, 'k-12345678', 'app')`]) {
      await denied(as(db, ids[role], (tx) => tx.query(sql)));
    }
  }
  await denied(asUser(db, null, (tx) => rpc(tx, "inv_page3", { p_month: null, p_analytics: false }), { role: "anon" }));
  // the admin tier never writes, directly or through RLS
  await assert.rejects(as(db, ids.admin, (tx) => tx.query(`insert into public.inv_stock_counts (product_id, month, entry_date, counted, balance_before, idempotency_key) values ($1, '2026-12-01', '2026-12-01', 1, 0, 'k-12345678')`, [a])));
});

test("rollover dry run (read-only SQL): its counts match what the rollover then does, with and without 0031", async () => {
  const { dryRunSql } = await import("../../scripts/inventory/rollover-dry-run.mjs");
  // exactly how the script runs it: inside a read-only transaction
  const readOnly = async (db, asOf) => {
    await db.exec("begin read only");
    try {
      return (await db.query(dryRunSql(asOf))).rows[0];
    } finally {
      await db.exec("rollback");
    }
  };
  // before 0031: only the 0028 tables exist
  const pre = await setup({ countsFrom: null, migrations: { upTo: "0030_inventory_fields.sql" } });
  await november(pre.db, pre.ids);
  const p = await readOnly(pre.db, "2026-12-01");
  assert.equal(p.counts_from, null);
  assert.equal(p.months_to_close.length, 1);
  assert.deepEqual(p.months_to_close[0], { month: "2026-11-01", table: "inv_month_snapshots", snapshot_rows: 4, archived_in_it: 1, ledger_entries_in_month: 3 });
  assert.equal(Number(p.pending_on_as_of), 0, "no counting without 0031");

  // with 0031: November closes the old way, then 3 active products are pending
  const { db, ids } = await setup();
  const { a } = await november(db, ids);
  const before = await db.query(`select count(*)::int n from public.inv_month_snapshots`);
  const d = await readOnly(db, "2026-12-01");
  assert.equal((await db.query(`select count(*)::int n from public.inv_month_snapshots`)).rows[0].n, before.rows[0].n, "the dry run wrote nothing");
  assert.equal(d.counts_from, "2026-12-01");
  assert.deepEqual(d.months_to_close.map((m) => [m.month, m.table, Number(m.snapshot_rows)]), [["2026-11-01", "inv_month_snapshots", 4]]);
  assert.equal(Number(d.pending_on_as_of), 3);
  await setToday(db, "2026-12-01");
  const pg = await page3(db, ids.inventory);
  assert.equal(pg.pending_count, Number(d.pending_on_as_of));
  assert.equal((await db.query(`select count(*)::int n from public.inv_month_snapshots where month = '2026-11-01'`)).rows[0].n, 4);
  // a gap: as of March, December..February go to the 0031 tables
  await count(db, ids, a, "1");
  const g = await readOnly(db, "2027-03-01");
  assert.deepEqual(g.months_to_close.map((m) => [m.month, m.table]), [["2026-12-01", "inv_month_snapshots2"], ["2027-01-01", "inv_month_snapshots2"], ["2027-02-01", "inv_month_snapshots2"]]);
  assert.equal(Number(g.pending_on_as_of), 3);
  // writes are refused inside the dry run's transaction
  await db.exec("begin read only");
  await assert.rejects(db.query(`insert into public.inv_closed_months2 (month, products) values ('2030-01-01', 0)`), /read-only/);
  await db.exec("rollback");
});

test("backup + restore (0031): stock counts and the 0031 snapshots come back exactly; the over-issue guard doesn't block a restore", async () => {
  const { TABLES, restoreSql } = await import("../../scripts/inventory/backup.mjs");
  const { db, ids } = await setup();
  await setToday(db, "2026-11-17");
  const p = await addProduct(db, ids, "ZZ-950", "0");
  await setToday(db, "2026-12-01");
  // counted 10 (+10), issue all 10, receive 5, recount 0: restored in id order, the issue comes before the counts
  await entry(db, ids, p, "issue", "10", "2026-12-01", { p_count: "10", p_count_key: randomUUID() });
  await entry(db, ids, p, "receive", "5", "2026-12-01");
  assert.equal((await count(db, ids, p, "0")).adjustment, "-5");
  await setToday(db, "2027-01-03");
  await page3(db, ids.inventory); // closes December into the 0031 tables
  const take = async (d) => {
    const out = { format: 1, taken_at: "2027-01-03T04:30:00.000Z", taken_ist: "x", project_ref: "test", tables: {} };
    for (const t of TABLES) {
      const r = await d.query(`select coalesce(jsonb_agg(to_jsonb(x) order by ${t.order}), '[]'::jsonb) as rows from public.${t.name} x`);
      out.tables[t.name] = { count: r.rows[0].rows.length, rows: r.rows[0].rows };
    }
    return out;
  };
  const backup = await take(db);
  assert.equal(backup.tables.inv_stock_counts.count, 2);
  assert.equal(backup.tables.inv_month_snapshots2.count, 1);
  const sql = restoreSql(backup);
  const b = await setup({ countsFrom: "2027-02-01" }); // a fresh database that would start counting later
  b.ids = ids;
  for (const [role, id] of Object.entries(ids)) {
    await b.db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3) on conflict do nothing`,
      [id, `r-${role}@example.invalid`, JSON.stringify({ username: `r_${role}`, full_name: `R ${role}`, role })]);
    await b.db.query(`update public.profiles set role = $2::user_role where id = $1`, [id, role]);
  }
  await setToday(b.db, "2027-01-03");
  await b.db.exec(sql);
  await b.db.exec(sql); // twice: adds nothing
  const after = await take(b.db);
  for (const t of ["inv_count_settings", "inv_stock_counts", "inv_month_snapshots2", "inv_closed_months2", "inv_transactions", "inv_products"]) {
    assert.deepEqual(after.tables[t].rows, backup.tables[t].rows, `${t} restored exactly`);
  }
  assert.equal((await b.db.query(`select current_setting('inv.restoring', true) as v`)).rows[0].v ?? "", "", "the restore flag ends with its transaction");
  const pa = await page3(db, ids.admin), pb = await page3(b.db, ids.admin);
  assert.deepEqual(pb.rows, pa.rows);
  assert.deepEqual(pb.months, pa.months);
  // and the guard is back on after the restore (balance 0: any issue is refused, whoever writes it)
  await assert.rejects(b.db.query(`insert into public.inv_transactions (product_id, kind, qty, entry_date, idempotency_key)
                                   values ($1, 'issue', 1, '2027-01-03', $2)`, [p, randomUUID()]), /below zero/);
});

test("supabase/scripts/0031_verify.sql: every check is ok right after the migration", async () => {
  const { readFileSync } = await import("node:fs");
  const { db } = await setup({ countsFrom: null });
  const rows = (await db.query(readFileSync(join(REPO, "supabase/scripts/0031_verify.sql"), "utf8").replace(/^--.*$/gm, ""))).rows;
  assert.ok(rows.length >= 12);
  for (const r of rows) assert.equal(r.ok, true, r.check);
});
