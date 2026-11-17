// The inventory backup (scripts/inventory/backup.mjs): its restore SQL is
// additive, safe to run twice, and brings back exactly the same ledger,
// balances and settings in a fresh database. Fake data only.
//   npm i --no-save @electric-sql/pglite@0.3.15 && node --test tests/sql/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeDb, asUser } from "./harness.mjs";
import { TABLES, restoreSql, insideRepo } from "../../scripts/inventory/backup.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ROLES = ["head_admin", "admin", "inventory"];

async function freshDb(ids) {
  const db = await makeDb(REPO);
  for (const role of ROLES) {
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
      [ids[role], `t-${role}@example.invalid`, JSON.stringify({ username: `t_${role}`, full_name: `T ${role}`, role })]);
    await db.query(`update public.profiles set role = $2::user_role where id = $1`, [ids[role], role]);
  }
  return db;
}
const setToday = (db, iso) =>
  db.exec(`create or replace function public.inv_today() returns date language sql stable set search_path = public as $$ select '${iso}'::date $$;`);
const rpc = (tx, fn, args = {}) => {
  const names = Object.keys(args);
  return tx.query(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, Object.values(args)).then((x) => x.rows[0].r);
};

/** What the backup script reads over REST: every row as JSON, in the script's order. */
async function takeBackup(db) {
  const backup = { format: 1, taken_at: "2026-12-02T04:30:00.000Z", taken_ist: "2026-12-02_1000-IST", project_ref: "test", tables: {} };
  for (const t of TABLES) {
    const r = await db.query(`select coalesce(jsonb_agg(to_jsonb(x) order by ${t.order}), '[]'::jsonb) as rows from public.${t.name} x`);
    backup.tables[t.name] = { count: r.rows[0].rows.length, rows: r.rows[0].rows };
  }
  return backup;
}
const strip = (rows, keys) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k))));

test("backup restore: additive, repeatable, and gives back the same ledger and balances", async () => {
  const ids = Object.fromEntries(ROLES.map((r) => [r, randomUUID()]));
  const a = await freshDb(ids);
  await setToday(a, "2026-11-17");
  const inv = (fn, args) => asUser(a, ids.inventory, (tx) => rpc(tx, fn, args));

  // fake store: a custom column, products using it, receipts with details, an issue, a reversal, settings
  const col = await inv("inv_add_column", { p_label: "Make", p_data_type: "text" });
  assert.equal(col.status, "ok", JSON.stringify(col));
  const p = [];
  for (let i = 1; i <= 3; i++) {
    const r = await inv("inv_add_product_v2", { p_serial_no: `ZZ-${i}`, p_description: `Dummy part ${i}`, p_specification: `${i} mm`,
      p_rate: `${i}.50`, p_opening_qty: `${i * 10}`, p_custom: JSON.stringify({ [col.id]: `Fake make ${i}` }), p_min_stock: i === 2 ? "25" : null });
    assert.equal(r.status, "ok", JSON.stringify(r));
    p.push(r.id);
  }
  const entry = async (pid, kind, qty, extra = {}, date = "2026-11-17") => {
    const r = await inv("inv_record_entry", { p_product_id: pid, p_kind: kind, p_qty: qty, p_entry_date: date,
      p_note: null, p_idempotency_key: randomUUID(), p_party: null, p_challan_no: null, p_bill_no: null, p_bill_date: null, p_job_no: null,
      p_rating: null, p_no_of_jobs: null, ...extra });
    assert.equal(r.status, "ok", JSON.stringify(r));
    return r;
  };
  await entry(p[0], "receive", "5.250", { p_party: "Sample Traders", p_challan_no: "CH-1", p_bill_no: "B-1", p_bill_date: "2026-11-16" });
  const issued = await entry(p[1], "issue", "7", { p_job_no: "J-9", p_rating: "100 kVA", p_no_of_jobs: "2" });
  assert.equal(issued.status, "ok", JSON.stringify(issued));
  const rev = await inv("inv_reverse_entry", { p_transaction_id: issued.id, p_note: "wrong item", p_idempotency_key: randomUUID() });
  assert.equal(rev.status, "ok", JSON.stringify(rev));
  await entry(p[2], "issue", "3");
  await inv("inv_save_settings", { p_person_name: "Fake Store Person", p_phone: "+91 90000 00000" });
  // a closed month: November rolls over when December starts
  await setToday(a, "2026-12-02");
  await inv("inv_rollover", {});
  await entry(p[0], "issue", "1.250", {}, "2026-12-02");

  const backup = await takeBackup(a);
  assert.equal(backup.tables.inv_transactions.count, 5);
  assert.equal(backup.tables.inv_closed_months.count, 1);
  assert.ok(backup.tables.inv_transactions.rows.some((r) => r.reverses_id && r.job_no === "J-9"), "the reversal copied its details");
  for (const t of ["inv_products", "inv_transactions", "inv_month_snapshots", "inv_closed_months", "inv_product_log", "inv_settings"]) {
    assert.ok(backup.tables[t].count > 0, `fake data has ${t}`);
  }
  const sql = restoreSql(backup);
  // additive only
  const code = sql.replace(/\$nr[0-9a-z]*\$[\s\S]*?\$nr[0-9a-z]*\$/g, "''").replace(/--[^\n]*/g, "");
  assert.doesNotMatch(code, /\b(delete|truncate|drop|alter)\b/i);
  assert.doesNotMatch(code, /^\s*update\b/im);

  // restore into a fresh database (its default columns were made by the migration under other ids)
  const b = await freshDb(ids);
  await setToday(b, "2026-12-02");
  await b.exec(sql);
  await b.exec(sql); // a second run adds nothing
  const after = await takeBackup(b);
  for (const t of TABLES) {
    if (t.name === "inv_columns") continue;
    assert.deepEqual(after.tables[t.name].rows, backup.tables[t.name].rows, `${t.name} restored exactly`);
  }
  // columns: defaults match on key, custom ones keep their id (products' custom fields point at it)
  const cols = (bk) => strip(bk.tables.inv_columns.rows, ["created_at", "updated_at"]).map((c) => (c.key ? { ...c, id: c.key } : c));
  assert.deepEqual(cols(after).sort((x, y) => String(x.id).localeCompare(String(y.id))), cols(backup).sort((x, y) => String(x.id).localeCompare(String(y.id))));

  // the screen shows the same: balances, minimums, low stock, party data
  const page = (db) => asUser(db, ids.inventory, (tx) => rpc(tx, "inv_page2", { p_month: null, p_analytics: false }));
  const pa = await page(a), pb = await page(b);
  assert.deepEqual(pb.rows, pa.rows);
  assert.equal(pb.low_count, pa.low_count);
  assert.deepEqual(pb.parties, pa.parties);
  const nov = (db) => asUser(db, ids.inventory, (tx) => rpc(tx, "inv_page2", { p_month: "2026-11-01", p_analytics: false }));
  assert.deepEqual((await nov(b)).rows, (await nov(a)).rows, "the closed month reads the same");

  // new entries keep working after a restore (identity counters moved past the restored ids)
  const asB = (fn, args) => asUser(b, ids.inventory, (tx) => rpc(tx, fn, args));
  const next = await asB("inv_record_entry", { p_product_id: p[2], p_kind: "receive", p_qty: "1", p_entry_date: "2026-12-02", p_note: null,
    p_idempotency_key: randomUUID(), p_party: null, p_challan_no: null, p_bill_no: null, p_bill_date: null, p_job_no: null, p_rating: null, p_no_of_jobs: null });
  assert.equal(next.status, "ok", JSON.stringify(next));
});

test("backup refuses to write inside the repository", () => {
  assert.equal(insideRepo(REPO, REPO), true);
  assert.equal(insideRepo(join(REPO, "backups", "x"), REPO), true);
  assert.equal(insideRepo(join(REPO, "..", "NR-Backups"), REPO), false);
  assert.equal(insideRepo("/mnt/d/NR-Backups/inventory", REPO), false);
});
