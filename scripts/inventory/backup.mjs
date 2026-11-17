#!/usr/bin/env node
// Read-only backup of the Inventory tables (inv_*) to a local folder outside
// the repository.
//
//   node scripts/inventory/backup.mjs                  # to D:\NR-Backups\inventory (default)
//   node scripts/inventory/backup.mjs --out "E:\Backups"
//
// It only reads, in one of two ways:
//   - SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (shell only): SELECTs through
//     the Management API inside "begin read only ... rollback", so Postgres
//     itself refuses any write;
//   - otherwise NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY: GET
//     requests to the REST API (no writes, no RPCs).
// It contains no data and no keys, and it never prints a secret or a row:
// only table names and row counts.
//
// Each run writes three files, named by the IST time of the run:
//   inventory-backup-<stamp>.json         every row of every inv_ table
//   inventory-backup-<stamp>.restore.sql  the same rows as INSERTs (see docs/inventory/BACKUP.md)
//   inventory-backup-<stamp>.sha256       checksums of both files
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, realpathSync, existsSync } from "node:fs";
import { resolve, join, relative, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, localPath, projectRef, dollarTag, managementQuery } from "./lib.mjs";

/** Tables in restore order (parents first) and the columns that keep the order stable. */
export const TABLES = [
  { name: "inv_columns", order: "id" },
  { name: "inv_settings", order: "id" },
  { name: "inv_products", order: "id" },
  { name: "inv_transactions", order: "id", identity: "id", generated: ["delta"] },
  { name: "inv_month_snapshots", order: "product_id,month" },
  { name: "inv_closed_months", order: "month" },
  { name: "inv_product_log", order: "id", identity: "id" },
];

const PAGE = 1000; // the REST API's row cap per request

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** True when `dir` is the repository or inside it (following symlinks where they exist). */
export function insideRepo(dir, repo = REPO) {
  const real = (p) => {
    let cur = p;
    while (!existsSync(cur) && dirname(cur) !== cur) cur = dirname(cur);
    return join(realpathSync(cur), relative(cur, p));
  };
  const rel = relative(real(repo), real(dir));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** "2026-11-17_1530-IST" */
export function istStamp(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}-IST`;
}

async function fetchAll(url, key, table) {
  const rows = [];
  let total = null;
  for (let offset = 0; ; offset += PAGE) {
    const q = `${url}/rest/v1/${table.name}?select=*&order=${table.order}&limit=${PAGE}&offset=${offset}`;
    const res = await fetch(q, {
      method: "GET",
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", Prefer: "count=exact" },
    });
    if (!res.ok) throw new Error(`${table.name}: the database said ${res.status} ${(await res.text()).slice(0, 200)}`);
    const range = res.headers.get("content-range"); // "0-999/1234"
    if (range && total === null) total = Number(range.split("/")[1]);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  if (total !== null && Number.isFinite(total) && total !== rows.length) {
    throw new Error(`${table.name}: counted ${total} rows but read ${rows.length}; someone changed it during the backup, run it again`);
  }
  return rows;
}

/** The same rows through the Management API, in a read-only transaction. */
async function fetchAllSql(env, table) {
  const rows = [];
  let total = null;
  for (let offset = 0; ; offset += PAGE) {
    const res = await managementQuery(env, `begin read only;
      select coalesce(jsonb_agg(to_jsonb(x) order by ${table.order}), '[]'::jsonb) as rows,
             (select count(*) from public.${table.name}) as total
        from (select * from public.${table.name} order by ${table.order} limit ${PAGE} offset ${offset}) x;
      rollback;`);
    const r = res[0];
    if (!r) throw new Error(`${table.name}: no answer from the database`);
    if (total === null) total = Number(r.total);
    const page = typeof r.rows === "string" ? JSON.parse(r.rows) : r.rows;
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  if (total !== rows.length) {
    throw new Error(`${table.name}: counted ${total} rows but read ${rows.length}; someone changed it during the backup, run it again`);
  }
  return rows;
}

/** The restore SQL: additive INSERTs only, safe to run twice, never deletes or overwrites ledger rows. */
export function restoreSql(backup) {
  const out = [
    "-- Inventory restore, generated by scripts/inventory/backup.mjs",
    `-- Backup taken ${backup.taken_at} (${backup.taken_ist}), project ${backup.project_ref || "unknown"}`,
    "-- Read docs/inventory/BACKUP.md first. Run it on a database that already has",
    "-- migrations 0027-0030. It only ADDS rows that are missing (on conflict do",
    "-- nothing); it never deletes, and it never changes a ledger entry.",
    "begin;",
  ];
  for (const t of TABLES) {
    const rows = backup.tables[t.name]?.rows ?? [];
    out.push("", `-- ${t.name}: ${rows.length} rows`);
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]).filter((c) => !(t.generated ?? []).includes(c));
    const list = cols.map((c) => `"${c}"`).join(", ");
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = JSON.stringify(rows.slice(i, i + 500).map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))));
      const tag = dollarTag(chunk);
      const src = `from jsonb_populate_recordset(null::public.${t.name}, ${tag}${chunk}${tag}::jsonb)`;
      // inv_columns: the default columns already exist (migration 0028 makes them, locked, under
      // their own ids) and are skipped on their unique key; custom columns keep their ids, which
      // products' custom fields point at.
      if (t.name === "inv_settings") {
        out.push(`insert into public.inv_settings (${list}) select ${list} ${src}`);
        out.push(`  on conflict (id) do update set person_name = excluded.person_name, phone = excluded.phone, updated_at = excluded.updated_at, updated_by = excluded.updated_by;`);
      } else {
        out.push(`insert into public.${t.name} (${list})${t.identity ? " overriding system value" : ""} select ${list} ${src}`);
        out.push(`  on conflict do nothing;`);
      }
    }
    if (t.identity) {
      out.push(`select setval(pg_get_serial_sequence('public.${t.name}', '${t.identity}'), greatest((select max(${t.identity}) from public.${t.name}), 1));`);
    }
  }
  out.push("", "commit;", "", "-- Check: each count should be at least the number in the backup.");
  out.push(
    "select " + TABLES.map((t) => `(select count(*) from public.${t.name}) as ${t.name} /* backup: ${backup.tables[t.name]?.count ?? 0} */`).join(",\n       ") + ";",
  );
  return out.join("\n") + "\n";
}

async function main() {
  const env = loadEnv();
  const url = env.get("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const key = env.get("SUPABASE_SERVICE_ROLE_KEY");
  const viaToken = Boolean(env.get("SUPABASE_ACCESS_TOKEN") && projectRef(env));
  if (!viaToken && (!url || !key)) {
    console.error("Set SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF in the shell, or NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  const outDir = resolve(localPath(arg("--out") || env.get("INVENTORY_BACKUP_DIR") || "D:\\NR-Backups\\inventory"));
  if (insideRepo(outDir)) {
    console.error(`Refusing to write inside the repository (${outDir}). Backups hold real data; choose a folder outside it.`);
    process.exit(1);
  }

  const now = new Date();
  const backup = { format: 1, taken_at: now.toISOString(), taken_ist: istStamp(now), project_ref: projectRef(env), tables: {} };
  console.log(viaToken ? `Reading project ${backup.project_ref} (read-only transaction)\n` : `Reading ${url} (REST, GET only)\n`);
  for (const t of TABLES) {
    const rows = viaToken ? await fetchAllSql(env, t) : await fetchAll(url, key, t);
    backup.tables[t.name] = { count: rows.length, rows };
    console.log(`${t.name.padEnd(20)} ${String(rows.length).padStart(7)} rows`);
  }

  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, `inventory-backup-${backup.taken_ist}`);
  const json = JSON.stringify(backup);
  const sql = restoreSql(backup);
  writeFileSync(`${base}.json`, json);
  writeFileSync(`${base}.restore.sql`, sql);
  const sum = (s) => createHash("sha256").update(s).digest("hex");
  const name = (p) => p.slice(outDir.length + 1);
  writeFileSync(`${base}.sha256`, `${sum(json)}  ${name(`${base}.json`)}\n${sum(sql)}  ${name(`${base}.restore.sql`)}\n`);
  console.log(`\nSaved to ${outDir}:\n  ${name(`${base}.json`)}\n  ${name(`${base}.restore.sql`)}\n  ${name(`${base}.sha256`)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`Backup failed: ${e.message}`);
    process.exit(1);
  });
}
