// node --test: the Inventory exports' rows and files (0031): Opening +
// Adjustment + Received − Issued = Closing, an Adjustment column only when
// one is non-zero, "Pending" for an uncounted balance, pending products left
// out of the value, and text cells always written as text (never a formula).
// Fake data only.
import "./helpers/alias.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";

const { buildExportModel, textTable, docxWidths } = await import("../lib/inventory/export-model.ts");
const { buildXlsx } = await import("../lib/inventory/xlsx.ts");
const { buildDocx } = await import("../lib/inventory/docx.ts");

const col = (key, label, i) => ({ id: `c${i}`, key, label, data_type: key === "rate" ? "number" : "text", position: i * 10, is_default: true, visible: true, archived: false });
const COLUMNS = ["serial_no", "description", "specification", "rate", "opening", "receiving", "issue", "balance"].map((k, i) => col(k, k, i));
const product = (serial, o, a, r, i, extra = {}) => ({
  id: serial, serial_no: serial, description: `Dummy ${serial}`, specification: "Sample", rate: "10.00", custom: {}, is_active: true,
  opening: o, adjustment: a, received: r, issued: i, balance: String(Number(o) + Number(a) + Number(r) - Number(i)), ...extra,
});
const report = (products) => ({ from: "2026-12-01", to: "2026-12-31", current_month: "2026-12-01", columns: COLUMNS, settings: null, products });

/** Files of a zip (test reader). */
function unzip(buf) {
  let e = buf.length - 22;
  while (buf.readUInt32LE(e) !== 0x06054b50) e--;
  const n = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const out = {};
  for (let k = 0; k < n; k++) {
    const size = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nl);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    out[name] = inflateRawSync(buf.subarray(start, start + size)).toString("utf8");
    p += 46 + nl + xl + cl;
  }
  return out;
}

test("export model: the identity on every row, the Adjustment column only when needed, pending out of the value", () => {
  const m = buildExportModel(report([
    product("ZZ-1", "12", "-2", "5", "4"),
    product("ZZ-2", "4", "0", "0", "0", { pending: true }),
    product("ZZ-3", "1.5", "0.25", "0", "1"),
  ]), "This month", new Date("2026-12-10T10:00:00Z"));
  for (const r of m.rows) assert.equal(r.opening + r.adjustment + r.received - r.issued, r.closing, r.serial);
  assert.equal(m.showAdjustment, true);
  assert.deepEqual(m.counts, { active: 3, confirmed: 2, pending: 1 });
  // value: 11 × 10 + 0.75 × 10 = 117.50 (the pending product is not counted)
  assert.equal(m.totals.value, BigInt(11750));
  assert.equal(m.totals.adjustment, BigInt(-1750));
  const t = textTable(m);
  assert.deepEqual(t.head.slice(4, 10), ["Opening", "Adjustment", "Received", "Issued", "Closing", "Closing value"]);
  assert.equal(t.head.length, docxWidths(m).length);
  assert.deepEqual(t.rows[0].slice(4, 9), ["12", "−2", "5", "4", "11"]);
  assert.deepEqual(t.rows[1].slice(8, 10), ["Pending", "—"]);
  assert.equal(t.rows[2][5], "+0.25");
  // November-like: no adjustment anywhere -> the old columns exactly
  const old = textTable(buildExportModel(report([product("ZZ-1", "12", "0", "5", "4")]), "This month", new Date()));
  assert.deepEqual(old.head, ["Serial No", "Material Description", "Specification", "Rate", "Opening", "Received", "Issued", "Closing", "Closing value"]);
});

test("Excel: identity holds in the sheet, Pending is text, text cells are never formulas", () => {
  const evil = ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "=HYPERLINK(\"http://x.invalid\")"];
  const m = buildExportModel(report([
    product("ZZ-1", "12", "-2", "5", "4"),
    product("ZZ-2", "4", "0", "0", "0", { pending: true }),
    ...evil.map((e, i) => product(`ZZ-E${i}`, "1", "0", "0", "0", { description: e, specification: e, serial_no: `ZZ-E${i}` })),
  ]), "This month", new Date());
  const files = unzip(buildXlsx(m, { company: "Test Co", subtitle: "x", generated: "y" }));
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.doesNotMatch(sheet, /<f[ >]/, "no formula element anywhere");
  for (const e of evil) assert.ok(sheet.includes(`t="inlineStr"><is><t xml:space="preserve">${e.replace(/"/g, "&quot;")}</t>`), `${e} is an inline string`);
  // the header row and the first data row
  const rows = [...sheet.matchAll(/<row r="(\d+)">(.*?)<\/row>/g)].map((x) => [Number(x[1]), x[2]]);
  const cells = (xml) => [...xml.matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>(.*?)<\/c>)/g)].map((c) => ({ col: c[1], v: (c[2] ?? "").replace(/<[^>]+>/g, "") }));
  const head = cells(rows.find(([r]) => r === 5)[1]).map((c) => c.v);
  assert.deepEqual(head.slice(4, 10), ["Opening", "Adjustment", "Received", "Issued", "Closing", "Closing value (₹)"]);
  const r1 = cells(rows.find(([r]) => r === 6)[1]).map((c) => c.v);
  assert.equal(Number(r1[4]) + Number(r1[5]) + Number(r1[6]) - Number(r1[7]), Number(r1[8]));
  const r2 = cells(rows.find(([r]) => r === 7)[1]).map((c) => c.v);
  assert.deepEqual(r2.slice(8, 10), ["Pending", "—"]);
  assert.match(sheet, /1 of 2 active products confirmed|6 of 7 active products confirmed/);
});

test("Word: the Adjustment column and Pending; text is escaped, never markup", () => {
  const m = buildExportModel(report([product("ZZ-1", "12", "-2", "5", "4"), product("ZZ-2", "4", "0", "0", "0", { pending: true, description: "<b>&\"x\"" })]), "This month", new Date());
  const t = textTable(m);
  const doc = buildDocx({ title: "T", subtitle: "S", generated: "G", company: "C", address: ["A"], logo: { jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), aspect: 1 },
    summary: ["x"], head: t.head, right: t.right, rows: t.rows, widths: docxWidths(m), totalLine: "t" });
  const xml = unzip(doc)["word/document.xml"];
  assert.ok(xml.includes(">Adjustment<"));
  assert.ok(xml.includes(">Pending<"));
  assert.ok(xml.includes("&lt;b&gt;&amp;&quot;x&quot;"));
  assert.ok(!xml.includes("<b>&"));
});
