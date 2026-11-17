// 0030 (receive / issue details, minimum stock, Party search) on a real
// Postgres 17 in-process (PGlite), every migration applied. Fake data only.
//   npm i --no-save @electric-sql/pglite@0.3.15 && node --test tests/sql/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeDb, asUser, applyFile } from "./harness.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ROLES = ["head_admin", "admin", "marketing", "production", "dispatcher", "inventory"];

async function setup(today = "2026-11-17") {
  const db = await makeDb(REPO);
  const ids = {};
  for (const role of ROLES) {
    const id = randomUUID();
    ids[role] = id;
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
      [id, `t-${role}@example.invalid`, JSON.stringify({ username: `t_${role}`, full_name: `T ${role}`, role })]);
    await db.query(`update public.profiles set role = $2::user_role where id = $1`, [id, role]);
  }
  await setToday(db, today);
  return { db, ids };
}
async function setToday(db, iso) {
  await db.exec(`create or replace function public.inv_today() returns date language sql stable set search_path = public as $$ select '${iso}'::date $$;`);
}
const rpc = (tx, fn, args = {}) => {
  const names = Object.keys(args);
  return tx.query(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, Object.values(args)).then((x) => x.rows[0].r);
};
const as = (db, id, fn) => asUser(db, id, fn);
const denied = (p) => assert.rejects(p, (e) => /not permitted|permission denied/.test(e.message));
const inv = (db, ids, fn, args) => as(db, ids.inventory, (tx) => rpc(tx, fn, args));

async function product(db, ids, serial, opening = "10", min = null) {
  const r = await inv(db, ids, "inv_add_product_v2", { p_serial_no: serial, p_description: `Dummy ${serial}`, p_specification: "",
    p_rate: "1.00", p_opening_qty: opening, p_custom: "{}", p_min_stock: min });
  assert.equal(r.status, "ok", JSON.stringify(r));
  return r.id;
}
const entry = (db, ids, product_id, kind, qty, extra = {}, key = randomUUID(), date = "2026-11-17") =>
  inv(db, ids, "inv_record_entry", { p_product_id: product_id, p_kind: kind, p_qty: qty, p_entry_date: date, p_note: null,
    p_idempotency_key: key, p_party: null, p_challan_no: null, p_bill_no: null, p_bill_date: null, p_job_no: null,
    p_rating: null, p_no_of_jobs: null, ...extra });
const row = (db, sql, params = []) => db.query(sql, params).then((x) => x.rows[0]);

test("0030 changes no existing function and adds only nullable columns", async () => {
  const db = await makeDb(REPO, { upTo: "0029_inventory_perf.sql" });
  const fns = async () => (await db.query(`select p.oid::regprocedure::text n, md5(p.prosrc) h from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                                           where s.nspname = 'public' order by 1`)).rows;
  const before = await fns();
  await applyFile(db, REPO, "0030_inventory_fields.sql");
  await applyFile(db, REPO, "0030_inventory_fields.sql"); // idempotent
  const after = new Map((await fns()).map((f) => [f.n, f.h]));
  for (const f of before) assert.equal(after.get(f.n), f.h, `changed: ${f.n}`);
  const cols = (await db.query(`select table_name, column_name, is_nullable from information_schema.columns
                                 where table_schema = 'public' and column_name in ('party','party_key','challan_no','bill_no','bill_date','job_no','rating','no_of_jobs','min_stock')`)).rows;
  assert.equal(cols.length, 9);
  assert.ok(cols.every((c) => c.is_nullable === "YES"));
});

test("details: trimmed, normalised party key, right fields for the kind, lengths, bill date", async () => {
  const { db, ids } = await setup();
  const p = await product(db, ids, "F-001");
  let r = await entry(db, ids, p, "receive", "5", { p_party: "  Shree   Dummy  Traders ", p_challan_no: " CH-1 ", p_bill_no: "B 7", p_bill_date: "2026-11-10" });
  assert.equal(r.status, "ok");
  const t = await row(db, `select party, party_key, challan_no, bill_no, bill_date::text from public.inv_transactions where id = $1`, [r.id]);
  assert.deepEqual(t, { party: "Shree Dummy Traders", party_key: "shree dummy traders", challan_no: "CH-1", bill_no: "B 7", bill_date: "2026-11-10" });

  // issue-only fields on a receipt, receive-only fields on an issue: refused
  assert.equal((await entry(db, ids, p, "receive", "1", { p_job_no: "J1" })).status, "invalid");
  assert.equal((await entry(db, ids, p, "issue", "1", { p_party: "X" })).status, "invalid");
  assert.equal((await entry(db, ids, p, "issue", "1", { p_bill_date: "2026-11-01" })).status, "invalid");
  // lengths
  assert.equal((await entry(db, ids, p, "receive", "1", { p_party: "x".repeat(121) })).status, "invalid");
  assert.equal((await entry(db, ids, p, "receive", "1", { p_challan_no: "x".repeat(61) })).status, "invalid");
  assert.equal((await entry(db, ids, p, "issue", "1", { p_no_of_jobs: "1".repeat(21) })).status, "invalid");
  // bill date not in the future; an earlier one is fine
  assert.equal((await entry(db, ids, p, "receive", "1", { p_bill_date: "2026-11-18" })).status, "invalid");
  assert.equal((await entry(db, ids, p, "receive", "1", { p_bill_date: "2026-09-30" })).status, "ok");
  // issue details stored; blanks become nothing
  r = await entry(db, ids, p, "issue", "2", { p_job_no: " JOB-9 ", p_rating: "100 kVA", p_no_of_jobs: "3", p_party: "   " });
  assert.equal(r.status, "ok");
  assert.deepEqual(await row(db, `select job_no, rating, no_of_jobs, party from public.inv_transactions where id = $1`, [r.id]),
    { job_no: "JOB-9", rating: "100 kVA", no_of_jobs: "3", party: null });
  // the same rules as before: over-issue, date, decimals
  assert.equal((await entry(db, ids, p, "issue", "999")).status, "insufficient");
  assert.equal((await entry(db, ids, p, "receive", "1", {}, randomUUID(), "2026-10-31")).status, "invalid");
  assert.equal((await entry(db, ids, p, "receive", "0.0001")).status, "invalid");
});

test("the old record / reverse functions still work, unchanged", async () => {
  const { db, ids } = await setup();
  const p = await product(db, ids, "F-002", "4");
  const r = await inv(db, ids, "inv_record_transaction", { p_product_id: p, p_kind: "receive", p_qty: "2", p_entry_date: "2026-11-17", p_note: null, p_idempotency_key: randomUUID() });
  assert.equal(r.status, "ok");
  assert.equal(r.balance_after, "6.000");
  const v = await inv(db, ids, "inv_reverse_transaction", { p_transaction_id: r.id, p_note: null, p_idempotency_key: randomUUID() });
  assert.equal(v.status, "ok");
  assert.equal(Number(v.balance_after), 4);
});

test("double submit: the same key records once (new function)", async () => {
  const { db, ids } = await setup();
  const p = await product(db, ids, "F-003", "0");
  const key = randomUUID();
  const a = await entry(db, ids, p, "receive", "3", { p_party: "Dummy Co" }, key);
  const b = await entry(db, ids, p, "receive", "3", { p_party: "Dummy Co" }, key);
  assert.equal(a.status, "ok");
  assert.equal(b.status, "duplicate");
  assert.equal(b.id, a.id);
  assert.equal((await row(db, `select count(*)::int c from public.inv_transactions where idempotency_key = $1`, [key])).c, 1);
});

test("reverse entry copies the original's details", async () => {
  const { db, ids } = await setup();
  const p = await product(db, ids, "F-004", "0");
  const a = await entry(db, ids, p, "receive", "8", { p_party: "Dummy Supplier", p_challan_no: "C9", p_bill_no: "B9", p_bill_date: "2026-11-02" });
  const r = await inv(db, ids, "inv_reverse_entry", { p_transaction_id: a.id, p_note: null, p_idempotency_key: randomUUID() });
  assert.equal(r.status, "ok");
  const t = await row(db, `select reverses_id, party, party_key, challan_no, bill_no, bill_date::text from public.inv_transactions where id = $1`, [r.id]);
  assert.deepEqual(t, { reverses_id: a.id, party: "Dummy Supplier", party_key: "dummy supplier", challan_no: "C9", bill_no: "B9", bill_date: "2026-11-02" });
  const i = await entry(db, ids, p, "receive", "5");
  const iss = await entry(db, ids, p, "issue", "2", { p_job_no: "J7", p_rating: "R", p_no_of_jobs: "2" });
  const r2 = await inv(db, ids, "inv_reverse_entry", { p_transaction_id: iss.id, p_note: null, p_idempotency_key: randomUUID() });
  assert.deepEqual(await row(db, `select job_no, rating, no_of_jobs from public.inv_transactions where id = $1`, [r2.id]), { job_no: "J7", rating: "R", no_of_jobs: "2" });
  assert.ok(i.status === "ok");
  // history2 shows the details on each entry
  const h = await as(db, ids.admin, (tx) => rpc(tx, "inv_product_history2", { p_product_id: p, p_limit: 25 }));
  assert.equal(h.details[String(a.id)].party, "Dummy Supplier");
  assert.equal(h.details[String(r2.id)].job_no, "J7");
  assert.equal(h.entries.length, 5);
});

test("low stock: below counts, equal doesn't, no minimum never, decimals exact", async () => {
  const { db, ids } = await setup();
  const a = await product(db, ids, "L-001", "4", "5");       // 4 < 5: low
  const b = await product(db, ids, "L-002", "5", "5");       // equal: not low
  await product(db, ids, "L-003", "0", null);                // no minimum: never
  const d = await product(db, ids, "L-004", "2.5", "2.5");   // equal
  const page = () => as(db, ids.inventory, (tx) => rpc(tx, "inv_page2", { p_month: null, p_analytics: false }));
  let pg = await page();
  assert.equal(pg.low_count, 1);
  assert.deepEqual(pg.extra_fields, ["min_stock", "last_party", "last_received"]);
  assert.equal(pg.extra[a][0], "5");
  // an issue of 0.001 takes L-004 to 2.499 < 2.5: low, and the answer says so
  const r = await entry(db, ids, d, "issue", "0.001", { p_job_no: "J" });
  assert.equal(r.below_min, true);
  assert.equal(r.min_stock, "2.500");
  pg = await page();
  assert.equal(pg.low_count, 2);
  // receiving brings it back: no longer low (computed from the live balance)
  await entry(db, ids, a, "receive", "1", { p_party: "Dummy Party" });
  pg = await page();
  assert.equal(pg.low_count, 1);
  assert.equal(pg.extra[a][1], "Dummy Party");
  assert.equal(pg.extra[a][2], "2026-11-17");
  // set / clear / bulk
  assert.equal((await inv(db, ids, "inv_set_min_stock", { p_product_id: b, p_min_stock: "-1" })).status, "invalid");
  assert.equal((await inv(db, ids, "inv_set_min_stock", { p_product_id: b, p_min_stock: "1.2345" })).status, "invalid");
  assert.equal((await inv(db, ids, "inv_set_min_stock", { p_product_id: b, p_min_stock: "6" })).status, "ok");
  assert.equal((await page()).low_count, 2);
  assert.equal((await inv(db, ids, "inv_set_min_stock", { p_product_id: b, p_min_stock: null })).status, "ok");
  const bulk = await inv(db, ids, "inv_set_min_stock_bulk", { p_product_ids: `{${a},${b},${d}}`, p_min_stock: "100" });
  assert.deepEqual(bulk, { status: "ok", changed: 3 });
  assert.equal((await page()).low_count, 3);
  // every change is in the product log, nothing deleted
  assert.ok((await row(db, `select count(*)::int c from public.inv_product_log where action = 'update' and after ? 'min_stock'`)).c >= 5);
  // a product's opening balance and serial still never change
  await assert.rejects(db.exec(`update public.inv_products set opening_qty = 1 where id = '${a}'`), /never change/);
});

test("party index: all months, net of reversals, case and spaces ignored", async () => {
  const { db, ids } = await setup("2026-10-20");
  const p = await product(db, ids, "P-001", "0");
  const q = await product(db, ids, "P-002", "0");
  await entry(db, ids, p, "receive", "10", { p_party: "Dummy  Traders", p_challan_no: "C1" }, randomUUID(), "2026-10-20");
  await setToday(db, "2026-11-17");
  const b = await entry(db, ids, p, "receive", "4", { p_party: "dummy traders", p_challan_no: "C2", p_bill_no: "B2", p_bill_date: "2026-11-16" });
  const c = await entry(db, ids, p, "receive", "1", { p_party: "DUMMY TRADERS", p_challan_no: "C3" });
  await inv(db, ids, "inv_reverse_entry", { p_transaction_id: c.id, p_note: null, p_idempotency_key: randomUUID() });
  await entry(db, ids, q, "receive", "2", { p_party: "Other Dummy Co" });
  await entry(db, ids, q, "receive", "1"); // no party: not in the index
  const ix = await as(db, ids.admin, (tx) => rpc(tx, "inv_party_index"));
  const rows = ix.rows.map((r) => Object.fromEntries(ix.fields.map((f, i) => [f, r[i]])));
  const pr = rows.filter((r) => r.product_id === p);
  assert.equal(pr.length, 1);
  assert.equal(pr[0].party_key, "dummy traders");
  assert.equal(pr[0].qty, "14");            // 10 (Oct) + 4 + 1 − 1 (reversed)
  assert.equal(pr[0].challan_no, "C2");     // the reversal's copy is not "the last challan"
  assert.equal(pr[0].bill_no, "B2");
  assert.equal(pr[0].last_date, "2026-11-17");
  assert.equal(rows.filter((r) => r.product_id === q).length, 1);
  const pg = await as(db, ids.inventory, (tx) => rpc(tx, "inv_page2", { p_month: null, p_analytics: false }));
  assert.deepEqual(pg.parties, ["DUMMY TRADERS", "Other Dummy Co"]); // newest spelling per party
  assert.ok(b.status === "ok");
});

test("role matrix for everything new", async () => {
  const { db, ids } = await setup();
  const p = await product(db, ids, "R-001", "5", "2");
  for (const role of ROLES) {
    const view = ["inventory", "head_admin", "admin"].includes(role);
    const reads = [
      (tx) => rpc(tx, "inv_page2", { p_month: null, p_analytics: true }),
      (tx) => rpc(tx, "inv_party_index"),
      (tx) => rpc(tx, "inv_product_history2", { p_product_id: p, p_limit: 5 }),
      (tx) => rpc(tx, "inv_min_stock_list"),
    ];
    for (const r of reads) {
      if (view) assert.ok(await as(db, ids[role], r));
      else await denied(as(db, ids[role], r));
    }
    const writes = [
      (tx) => rpc(tx, "inv_record_entry", { p_product_id: p, p_kind: "receive", p_qty: "1", p_entry_date: "2026-11-17", p_note: null, p_idempotency_key: randomUUID(),
        p_party: null, p_challan_no: null, p_bill_no: null, p_bill_date: null, p_job_no: null, p_rating: null, p_no_of_jobs: null }),
      (tx) => rpc(tx, "inv_set_min_stock", { p_product_id: p, p_min_stock: "3" }),
      (tx) => rpc(tx, "inv_set_min_stock_bulk", { p_product_ids: `{${p}}`, p_min_stock: "3" }),
      (tx) => rpc(tx, "inv_add_product_v2", { p_serial_no: `X-${role}`, p_description: "x", p_specification: "", p_rate: null, p_opening_qty: "0", p_custom: "{}", p_min_stock: null }),
      (tx) => rpc(tx, "inv_update_product_v2", { p_product_id: p, p_description: "Dummy", p_specification: "", p_rate: "1", p_custom: "{}", p_min_stock: "2" }),
    ];
    for (const w of writes) {
      if (role === "inventory") assert.equal((await as(db, ids[role], w)).status, "ok");
      else await denied(as(db, ids[role], w));
    }
    // the new columns are not writable directly by anyone signed in
    await denied(as(db, ids[role], (tx) => tx.query(`update public.inv_products set min_stock = 1`)));
  }
  await denied(asUser(db, null, (tx) => rpc(tx, "inv_party_index"), { role: "anon" }));
  await denied(asUser(db, null, (tx) => rpc(tx, "inv_page2", { p_month: null, p_analytics: false }), { role: "anon" }));
  // marketing / production see no new column values through the tables either
  for (const role of ["marketing", "production"]) {
    const c = await as(db, ids[role], (tx) => tx.query(`select count(*)::int c from public.inv_transactions where party is not null or job_no is not null`));
    assert.equal(c.rows[0].c, 0);
  }
});
