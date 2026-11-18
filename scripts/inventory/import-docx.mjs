#!/usr/bin/env node
// ============================================================================
// Import the store's product list into the Inventory module (inv_ tables).
//
//   node scripts/inventory/import-docx.mjs            # dry run (default)
//   node scripts/inventory/import-docx.mjs --apply    # write (only if no blocking issue)
//
// Reads the file named by INVENTORY_DOCX_PATH in .env.local (or the env file
// in INVENTORY_ENV_FILE): a Word file (.docx), a PDF of the same sheet, or a
// JSON file in the import format (see inventory-sample.dummy.json).
//
// Maps: Serial No, Material Description, Specification, Rate, UOM (as a
// custom column), Opening Balance, and — when the sheet has them — the
// month's receipt / issue cells and the closing balance. Serials are kept
// exactly as written (only trimmed); duplicates are listed, never merged.
// The dry run prints counts and issues only: no product content is written
// to any file.
//
// --apply upserts on serial_no through public.inv_import_products (atomic:
// one bad row and nothing is written), either on the live project with
// SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (Management API) or with
// NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Re-running adds
// nothing (movements are keyed per cell). Nothing is ever deleted.
// ============================================================================
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { loadEnv, localPath, managementQuery, serviceRpc, dollarTag } from "./lib.mjs";
// The reading and number rules are shared with the app's "Import from document"
// (lib/inventory/sheet-read.ts, sheet-map.ts). Needs Node 23.6+ (or
// node --experimental-strip-types on Node 22) to load those .ts files.
import { zipDirectory, zipRead, xmlText as partText, docxTables as wordTables } from "../../lib/inventory/sheet-read.ts";
import { clean, RE, slotRuns, decimal as readDecimal, toMilli, fromMilli } from "../../lib/inventory/sheet-map.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");

// ── reading ─────────────────────────────────────────────────────────────

/** Node's zlib with a hard output limit (the shared zip reader asks for one). */
const inflate = async (data, maxOut) => new Uint8Array(inflateRawSync(data, { maxOutputLength: Math.max(1, maxOut) }));

/** Tables of a .docx as arrays of rows of cell text (merged cells repeated as blanks). */
async function docxTables(buf) {
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const entries = zipDirectory(bytes);
  const doc = entries.find((e) => e.name === "word/document.xml");
  if (!doc) throw new Error("word/document.xml not found");
  return wordTables(partText(await zipRead(bytes, doc, inflate)), () => {}).tables;
}

function pdfTables(path) {
  const out = execFileSync("python3", [join(HERE, "pdf-tables.py"), path], { maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.toString("utf8")).tables;
}

// ── mapping ─────────────────────────────────────────────────────────────
// clean, RE (the heading patterns), slotRuns, the decimal reader and the
// thousandths helpers come from lib/inventory/sheet-map.ts (shared).

/** A printed sheet shows rounded numbers: up to 0.5 between opening + receipts − issues and the closing is rounding. */
const ROUNDING = BigInt(500);

/** Cells a spreadsheet wrote as a tiny float instead of 0 (like "1E-13" left over from x − x). */
export const artefacts = [];

/** Decimal text checked for scale; null = empty, false = invalid. */
const decimal = (s, scale) => readDecimal(s, scale, artefacts);

function mapSheet(tables) {
  // header row: the first row with a serial-number heading
  const all = tables.flat();
  const hIdx = all.findIndex((r) => r.some((c) => RE.serial.test(clean(c))));
  if (hIdx < 0) throw new Error("no header row with a Serial No column was found");
  const head = all[hIdx].map(clean);
  const width = head.length;
  const col = {};
  head.forEach((h, i) => {
    for (const k of ["serial", "description", "specification", "rate", "uom", "opening", "balance"]) {
      if (col[k] === undefined && h && RE[k].test(h)) col[k] = i;
    }
  });
  // a second header row of cell numbers (1, 2, 3 …) = receipt / issue cells
  const sub = all[hIdx + 1] ?? [];
  const isSub = !clean(sub[col.serial]) && slotRuns(sub).length > 0;
  const runs = isSub ? slotRuns(sub) : [];
  let receive = null;
  let issue = null;
  if (runs.length >= 2) {
    receive = runs[0];
    issue = runs[1];
  } else if (runs.length === 1) {
    if (head.slice(runs[0].start, runs[0].end + 2).some((h) => RE.issued.test(h))) issue = runs[0];
    else receive = runs[0];
  }

  const dataStart = hIdx + (isSub ? 2 : 1);
  const rows = [];
  let skippedHeaders = 0;
  let blankRows = 0;
  for (const t of tables) {
    for (const r of t) {
      const gi = all.indexOf(r);
      if (gi < dataStart) continue;
      if (r.length !== width) continue;
      if (r.some((c) => RE.serial.test(clean(c))) || (!clean(r[col.serial]) && slotRuns(r).length)) {
        skippedHeaders++;
        continue;
      }
      // blank template rows (no serial, nothing but zeros)
      if (!clean(r[col.serial]) && r.every((c) => !clean(c) || clean(c) === "0")) {
        blankRows++;
        continue;
      }
      rows.push(r);
    }
  }

  // unlabelled numeric columns between Rate and the first cell block:
  // opening (and closing balance, when opening + receipts − issues = it)
  const taken = new Set(Object.values(col));
  const inRuns = (i) => [receive, issue].some((r) => r && i >= r.start && i <= r.end);
  const numericCols = [];
  for (let i = 0; i < width; i++) {
    if (taken.has(i) || inRuns(i) || head[i]) continue;
    const vals = rows.map((r) => decimal(r[i], 3)).filter((v) => v !== null);
    if (vals.length >= rows.length * 0.9 && vals.every((v) => v !== false)) numericCols.push(i);
  }
  const notes = [];
  const sumCells = (r, run) => {
    let t = BigInt(0);
    if (!run) return t;
    for (let i = run.start; i <= run.end; i++) {
      const v = decimal(r[i], 3);
      if (v) t += toMilli(v);
    }
    return t;
  };
  if (col.opening === undefined && col.balance === undefined && numericCols.length < 2) {
    notes.push(`Unlabelled quantity columns found: ${numericCols.length} (columns ${numericCols.map((c) => c + 1).join(", ") || "none"}).`);
  }
  if (col.opening === undefined && numericCols.length >= 2 && col.balance === undefined) {
    const [a, b] = numericCols;
    const misfits = rows.filter((r) => {
      const va = decimal(r[a], 3);
      const vb = decimal(r[b], 3);
      if (!va || !vb) return false;
      const d = toMilli(va) + sumCells(r, receive) - sumCells(r, issue) - toMilli(vb);
      return d > ROUNDING || d < -ROUNDING;
    });
    const fits = misfits.length === 0;
    if (!fits) notes.push(`Columns ${a + 1} and ${b + 1} look like opening / closing, but opening + receipts − issues ≠ closing on ${misfits.length} of ${rows.length} rows: not mapped.`);
    if (fits) {
      col.opening = a;
      col.balance = b;
      notes.push(`Two unlabelled quantity columns: the first is the opening balance, the second the closing balance (opening + receipts − issues = closing on every row, within display rounding).`);
    }
  }
  if (col.opening === undefined && numericCols.length === 1 && !receive && !issue) {
    col.opening = numericCols[0];
    notes.push("Only one quantity column: treated as the opening balance.");
  }
  return { col, receive, issue, rows, notes, skippedHeaders, blankRows };
}

// ── validation + payload ────────────────────────────────────────────────

function build(sheet) {
  const { col, receive, issue, rows } = sheet;
  const blocking = [];
  const warnings = [];
  const products = [];
  const seen = new Map();
  let normalised = 0;
  let rounded = 0;
  const label = (r, i) => `row ${i + 1}${clean(r[col.serial]) ? ` (${clean(r[col.serial])})` : ""}`;

  rows.forEach((r, i) => {
    for (const k of ["serial", "description", "specification"]) {
      const raw = String(r[col[k]] ?? "");
      if (col[k] !== undefined && raw !== clean(raw)) normalised++;
    }
    const serial = clean(r[col.serial]);
    const description = col.description !== undefined ? clean(r[col.description]) : "";
    const specification = col.specification !== undefined ? clean(r[col.specification]) : "";
    if (!serial) return blocking.push(`${label(r, i)}: no serial number`);
    if (serial.length > 40) blocking.push(`${label(r, i)}: serial longer than 40 characters`);
    const key = serial.toUpperCase();
    if (seen.has(key)) blocking.push(`${label(r, i)}: duplicate serial (also row ${seen.get(key) + 1})`);
    else seen.set(key, i);
    if (!description) blocking.push(`${label(r, i)}: no material description`);
    if (description.length > 300 || specification.length > 300) blocking.push(`${label(r, i)}: text longer than 300 characters`);

    const rate = col.rate !== undefined ? decimal(r[col.rate], 2) : null;
    if (rate === false) blocking.push(`${label(r, i)}: rate is not a number with at most 2 decimals`);
    else if (rate === null) warnings.push(`${label(r, i)}: no rate`);
    else if (rate.startsWith("-")) blocking.push(`${label(r, i)}: negative rate`);

    const opening = col.opening !== undefined ? decimal(r[col.opening], 3) : null;
    if (opening === false) blocking.push(`${label(r, i)}: opening balance is not a number (max 3 decimals)`);
    if (col.opening !== undefined && opening === null) warnings.push(`${label(r, i)}: no opening balance (read as 0)`);
    if (opening && opening.startsWith("-")) blocking.push(`${label(r, i)}: negative opening balance`);

    const movements = [];
    for (const [kind, run] of [["receive", receive], ["issue", issue]]) {
      if (!run) continue;
      for (let c = run.start; c <= run.end; c++) {
        const v = decimal(r[c], 3);
        if (v === false) blocking.push(`${label(r, i)}: ${kind} cell ${c - run.start + 1} is not a number`);
        else if (v && v.startsWith("-")) blocking.push(`${label(r, i)}: negative ${kind} cell ${c - run.start + 1}`);
        else if (v && toMilli(v) > BigInt(0)) movements.push({ kind, qty: fromMilli(toMilli(v)), slot: c - run.start + 1 });
      }
    }
    let open = opening ? toMilli(opening) : BigInt(0);
    const rec = movements.filter((m) => m.kind === "receive").reduce((a, m) => a + toMilli(m.qty), BigInt(0));
    const iss = movements.filter((m) => m.kind === "issue").reduce((a, m) => a + toMilli(m.qty), BigInt(0));
    // the sheet's closing balance is the stock on hand: when the printed
    // (rounded) opening doesn't add up to it by up to 0.5, the opening is
    // taken as closing − receipts + issues, and the row is listed
    const balText = col.balance !== undefined ? decimal(r[col.balance], 3) : null;
    if (balText) {
      const d = open + rec - iss - toMilli(balText);
      if (d !== BigInt(0) && d <= ROUNDING && d >= -ROUNDING) {
        const derived = toMilli(balText) - rec + iss;
        const byQty = (k) => movements.filter((m) => m.kind === k).sort((x, y) => (toMilli(y.qty) > toMilli(x.qty) ? 1 : -1))[0];
        const bigRec = byQty("receive");
        const bigIss = byQty("issue");
        if (derived >= BigInt(0)) {
          warnings.push(`${label(r, i)}: opening ${fromMilli(open)} → ${fromMilli(derived)} so the balance matches the sheet (${fromMilli(toMilli(balText))}); the printed numbers are rounded`);
          open = derived;
        } else if (bigRec && toMilli(bigRec.qty) > d) {
          // the rounding sits in a receipt (the opening is already 0)
          const q = toMilli(bigRec.qty) - d;
          warnings.push(`${label(r, i)}: receipt cell ${bigRec.slot} ${bigRec.qty} → ${fromMilli(q)} so the balance matches the sheet (${fromMilli(toMilli(balText))}); the printed numbers are rounded`);
          bigRec.qty = fromMilli(q);
        } else if (bigIss) {
          const q = toMilli(bigIss.qty) + d;
          warnings.push(`${label(r, i)}: issue cell ${bigIss.slot} ${bigIss.qty} → ${fromMilli(q)} so the balance matches the sheet (${fromMilli(toMilli(balText))}); the printed numbers are rounded`);
          bigIss.qty = fromMilli(q);
        } else {
          blocking.push(`${label(r, i)}: the numbers don't add up to the sheet's balance`);
        }
        rounded++;
      }
    }
    const recF = movements.filter((m) => m.kind === "receive").reduce((a, m) => a + toMilli(m.qty), BigInt(0));
    const issF = movements.filter((m) => m.kind === "issue").reduce((a, m) => a + toMilli(m.qty), BigInt(0));
    const product = { serial_no: serial, description, specification, rate: rate || null, opening_qty: fromMilli(open), custom: {}, movements };
    if (col.uom !== undefined && clean(r[col.uom])) product.custom.UOM = clean(r[col.uom]);
    if (col.balance !== undefined) {
      const bal = decimal(r[col.balance], 3);
      if (bal === false) blocking.push(`${label(r, i)}: closing balance is not a number`);
      else if (bal !== null) {
        product.expected_balance = fromMilli(toMilli(bal));
        if (open + recF - issF !== toMilli(bal)) blocking.push(`${label(r, i)}: opening + receipts − issues ≠ closing balance on the sheet`);
      }
    }
    if (open + recF - issF < BigInt(0)) blocking.push(`${label(r, i)}: more issued than in stock`);
    if (open < BigInt(0)) blocking.push(`${label(r, i)}: negative opening balance`);
    products.push(product);
  });

  const payload = { columns: col.uom !== undefined ? [{ label: "UOM", data_type: "text" }] : [], products };
  return { payload, blocking, warnings, normalised, rounded };
}

// ── main ────────────────────────────────────────────────────────────────

const env = loadEnv();
const path = localPath(env.get("INVENTORY_DOCX_PATH"));
if (!path) {
  console.error(`Set INVENTORY_DOCX_PATH in ${env.file} (the Word / PDF product list).`);
  process.exit(1);
}
if (!existsSync(path)) {
  console.error("The file in INVENTORY_DOCX_PATH was not found.");
  process.exit(1);
}

const ext = extname(path).toLowerCase();
let payload;
let report = { notes: [], blocking: [], warnings: [], normalised: 0, skippedHeaders: 0, mapping: {} };
if (ext === ".json") {
  payload = JSON.parse(readFileSync(path, "utf8"));
  // same checks for a JSON file: rebuild it through the validator as a pseudo-sheet
  const rows = payload.products.map((p) => [p.serial_no, p.description, p.specification, p.rate ?? "", p.opening_qty ?? "", p.custom?.UOM ?? ""]);
  const res = build({ col: { serial: 0, description: 1, specification: 2, rate: 3, opening: 4, uom: 5 }, receive: null, issue: null, rows });
  res.payload.products.forEach((p, i) => (p.movements = payload.products[i].movements ?? []));
  ({ payload } = res);
  report = { ...report, blocking: res.blocking, warnings: res.warnings, mapping: { source: "json" } };
} else {
  const tables = ext === ".docx" ? await docxTables(readFileSync(path)) : ext === ".pdf" ? pdfTables(path) : null;
  if (!tables) {
    console.error("INVENTORY_DOCX_PATH must be a .docx, .pdf or .json file.");
    process.exit(1);
  }
  const sheet = mapSheet(tables);
  const res = build(sheet);
  payload = res.payload;
  report = {
    notes: sheet.notes,
    blocking: res.blocking,
    warnings: res.warnings,
    normalised: res.normalised,
    rounded: res.rounded,
    skippedHeaders: sheet.skippedHeaders,
    blankRows: sheet.blankRows,
    mapping: {
      source: ext.slice(1),
      tables: tables.length,
      columns: Object.fromEntries(Object.entries(sheet.col).map(([k, v]) => [k, `column ${v + 1}`])),
      receiptCells: sheet.receive ? sheet.receive.end - sheet.receive.start + 1 : 0,
      issueCells: sheet.issue ? sheet.issue.end - sheet.issue.start + 1 : 0,
    },
  };
}

const P = payload.products;
const moves = P.flatMap((p) => p.movements);
console.log(`Inventory import — ${APPLY ? "APPLY" : "dry run"}`);
console.log(`  source: ${report.mapping.source}${report.mapping.tables ? `, ${report.mapping.tables} table(s)` : ""}`);
if (report.mapping.columns) console.log(`  mapped: ${Object.entries(report.mapping.columns).map(([k, v]) => `${k} = ${v}`).join(", ")}`);
if (report.mapping.receiptCells || report.mapping.issueCells) console.log(`  cells:  ${report.mapping.receiptCells} receipt, ${report.mapping.issueCells} issue`);
for (const n of report.notes) console.log(`  note:   ${n}`);
console.log(`  products: ${P.length}  (with rate: ${P.filter((p) => p.rate).length}, with opening > 0: ${P.filter((p) => p.opening_qty !== "0").length}, with UOM: ${P.filter((p) => p.custom.UOM).length})`);
console.log(`  movements: ${moves.length}  (receipts: ${moves.filter((m) => m.kind === "receive").length}, issues: ${moves.filter((m) => m.kind === "issue").length})`);
console.log(`  whitespace trimmed in ${report.normalised} cell(s); repeated header rows skipped: ${report.skippedHeaders}; blank rows skipped: ${report.blankRows ?? 0}`);
if (artefacts.length) console.log(`  note:   ${new Set(artefacts).size === 1 ? "1 cell" : `${artefacts.length} cells`} held a spreadsheet rounding artefact for 0 (like 1E-13): read as 0.`);
if (report.rounded) console.log(`  note:   ${report.rounded} row(s) adjusted by at most 0.5 (opening, or one receipt / issue cell) so each balance equals the sheet's (rounded printing).`);
console.log(`  warnings: ${report.warnings.length}`);
for (const w of report.warnings.slice(0, process.argv.includes("--all") ? 1000 : 20)) console.log(`    - ${w}`);
console.log(`  BLOCKING issues: ${report.blocking.length}`);
for (const b of report.blocking.slice(0, 50)) console.log(`    - ${b}`);

if (!APPLY) {
  console.log(report.blocking.length ? "\nFix the blocking issues first. Nothing was written." : "\nNo blocking issues. Run again with --apply to import. Nothing was written.");
  process.exit(report.blocking.length ? 2 : 0);
}
if (report.blocking.length) {
  console.log("\nBlocking issues found: nothing was written.");
  process.exit(2);
}

const json = JSON.stringify(payload);
let result;
if (env.get("SUPABASE_ACCESS_TOKEN")) {
  const tag = dollarTag(json);
  const rows = await managementQuery(env, `select public.inv_import_products(${tag}${json}${tag}::jsonb) as result;`);
  result = rows[0]?.result;
} else {
  result = await serviceRpc(env, "inv_import_products", { p_payload: payload });
}
console.log("\nImported:", JSON.stringify(result));
