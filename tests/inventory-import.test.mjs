// node --test: "Import from document" — reading untrusted files and the preview.
// Fake fixtures only (tests/fixtures/import, made by make-fixtures.mjs); the zip
// bomb, the oversized file and the endless file are made here at run time.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateRawSync, deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  readSheet, sniff, zipDirectory, zipRead, xmlText, docxTables, csvRows, pdfRows, pdfTextItems, deadline, LIMITS, SheetError,
} from "../lib/inventory/sheet-read.ts";
import { readNumber, detectColumns, toRecords, planImport, serialKey } from "../lib/inventory/sheet-map.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = (name) => new Uint8Array(readFileSync(join(HERE, "fixtures/import", name)));
const inflate = async (data, maxOut) => {
  try {
    return new Uint8Array(inflateRawSync(data, { maxOutputLength: Math.max(1, maxOut) }));
  } catch (e) {
    if (/maxOutputLength|buffer/i.test(String(e?.message)) || e?.code === "ERR_BUFFER_TOO_LARGE") throw new SheetError("zip_bomb", "A part of the file is larger than it says.");
    throw new SheetError("corrupt", "The file is damaged.");
  }
};
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const io = { inflate, pdfItems: (b, check) => pdfTextItems(pdfjs, b, check) };
const read = (name) => readSheet(fx(name), io);
const rejects = (p, code) => assert.rejects(p, (e) => e instanceof SheetError && e.code === code, `expected ${code}`);
const q = (s) => BigInt(Math.round(Number(s) * 1000));

// a fake Inventory for the preview
const P = (id, serial, desc, bal, extra = {}) => ({ id, serial_no: serial, description: desc, specification: "", ratePaise: null, balance: q(bal), pending: true, is_active: true, ...extra });
const PRODUCTS = [
  P("p1", "ZZ-001", "Sample washer plate 1", "13"),
  P("p2", "ZZ-002", "Dummy sleeve 2", "26", { specification: "3 mm", ratePaise: BigInt(840) }),
  P("p3", "ZZ-003", "Demo bolt kit 3", "1"),
  P("p4", "ZZ-004", "Test gasket 4", "9"),
  P("p5", "ZZ-005", "Sample cable lug 5", "2"),
  P("p6", "ZZ-006", "Sample washer plate 6", "2"),
  P("p7", "ZZ-007", "Dummy sleeve 7", "2"),
  P("p8", "ZZ-008", "Demo bolt kit 8", "2"),
  P("p10", "ZZ-010", "Not in the file", "2"),
  P("p11", "ZZ-011", "Archived one", "0", { is_active: false }),
];

test("numbers: Indian grouping, ₹, spreadsheet leftovers; negatives and junk are reported, never guessed", () => {
  const ok = (s, scale, text) => {
    const r = readNumber(s, scale);
    assert.equal(r.kind, "ok", `${s} -> ${r.kind} ${r.text ?? ""}`);
    assert.equal(r.text, text, s);
  };
  ok("1,23,456.50", 3, "123456.5");
  ok("12,34,567", 3, "1234567");
  ok("1,234,567.125", 3, "1234567.125");
  ok("₹ 1,234.50", 2, "1234.5");
  ok("Rs. 99", 2, "99");
  ok("450/-", 2, "450");
  ok("0", 3, "0");
  ok(" 7 ", 3, "7");
  ok(".5", 3, "0.5");
  ok("12.300000000000001", 3, "12.3");
  ok("12.299999999999999", 3, "12.3");
  ok("2.5000", 3, "2.5");
  assert.equal(readNumber("1E-13", 3).kind, "ok");
  assert.equal(readNumber("1E-13", 3).text, "0");
  assert.equal(readNumber("1E-13", 3).artefact, true);
  assert.equal(readNumber("-1.0000000000000001E-13", 3).text, "0");
  assert.equal(readNumber("1.5E3", 3).text, "1500");
  for (const s of ["-3", "(4)", "5-", "−2"]) assert.equal(readNumber(s, 3).kind, "negative", s);
  for (const s of ["abc", "1,2", "1.234,56", "12.3456", "1..2", "N/A", "1 2 3x"]) assert.equal(readNumber(s, 3).kind, "bad", s);
  for (const s of ["", "-", "—", "   "]) assert.equal(readNumber(s, 3).kind, "empty", JSON.stringify(s));
});

test("serials match trimmed, without spaces, in any case", () => {
  assert.equal(serialKey(" zz 002 "), "ZZ002");
  assert.equal(serialKey("ZZ-002"), "ZZ-002");
  assert.equal(serialKey("zz-0 02"), "ZZ-002");
});

test("Word: the table, its headings found, the preview groups", async () => {
  const r = await read("fake-list.docx");
  assert.equal(r.kind, "docx");
  const d = detectColumns(r.rows);
  assert.deepEqual(d.mapping, { serial: 0, description: 1, specification: 2, rate: 3, balance: 4 });
  assert.equal(d.how.serial, "heading");
  const { records } = toRecords(r.rows, d);
  assert.equal(records.length, 13);
  const plan = planImport(records, PRODUCTS);
  const by = (arr) => arr.map((m) => m.product?.serial_no ?? m.record.serial).sort();
  assert.deepEqual(by(plan.matched), ["ZZ-001", "ZZ-002", "ZZ-003", "ZZ-004"]);
  const m2 = plan.matched.find((m) => m.product.id === "p2");
  assert.equal(m2.file, q("123456.5"), "Indian grouping read exactly");
  assert.deepEqual(m2.fill, {}, "spec and rate already set: never overwritten");
  const m1 = plan.matched.find((m) => m.product.id === "p1");
  assert.deepEqual(m1.fill, { specification: "2 mm", ratePaise: BigInt(470) }, "blanks filled from the file");
  assert.equal(plan.matched.find((m) => m.product.id === "p4").byDescription, true, "no serial: unique description");
  assert.deepEqual(plan.added.map((a) => a.record.serial).sort(), ["ZZ-900", "ZZ-901", "ZZ-903"]);
  const added903 = plan.added.find((a) => a.record.serial === "ZZ-903");
  assert.equal(added903.record.description, "=1+1", "text that looks like a formula stays text");
  const reasons = Object.fromEntries(plan.problems.map((p) => [p.serial + "@" + p.line, p.reason]));
  assert.equal(plan.problems.length, 6, JSON.stringify(plan.problems));
  assert.match(reasons["ZZ-902@8"], /without a description/);
  assert.match(reasons["ZZ-005@9"], /Negative/);
  assert.match(reasons["ZZ-006@10"], /No balance/);
  assert.match(reasons["ZZ-007@11"], /not a number/);
  assert.match(reasons["ZZ-008@12"], /Duplicate serial in the file \(lines 12, 13\)/);
  assert.match(reasons["ZZ-008@13"], /Duplicate/);
  assert.deepEqual(plan.notInFile.map((p) => p.serial_no), ["ZZ-010"], "archived products are not 'not in file'");
});

test("Excel: shared strings, inline text, formulas never calculated, 1E-13 read as 0, hidden sheet skipped", async () => {
  const r = await read("fake-list.xlsx");
  assert.equal(r.kind, "xlsx");
  assert.ok(r.notes.some((n) => /Sheet "Stock"/.test(n)), r.notes.join(" | "));
  assert.ok(r.notes.some((n) => /1 formula cell/.test(n)), "the formula without a saved value is reported");
  const d = detectColumns(r.rows);
  const { records, artefacts } = toRecords(r.rows, d);
  const by = Object.fromEntries(records.map((x) => [x.serial || x.description, x]));
  assert.equal(by["ZZ-003"].balance.text, "0", "1E-13 -> 0");
  assert.ok(artefacts >= 2);
  assert.equal(by["ZZ-900"].balance.text, "5", "a formula's SAVED value");
  assert.equal(by["ZZ-901"].balance.kind, "empty", "a formula without a saved value is empty, not calculated");
  assert.equal(by["ZZ-904"].description, "Inline text part");
  assert.equal(by["ZZ-904"].rate.text, "12.3", "binary noise rounded off");
  assert.equal(by["zz- 002"].balance.text, "123456.5");
  assert.ok(!records.some((x) => x.serial === "Hidden"), "the hidden sheet is not read");
});

test("CSV: BOM, quotes, Indian grouping, a tiny float", async () => {
  const r = await read("fake-list.csv");
  assert.equal(r.kind, "csv");
  const d = detectColumns(r.rows);
  assert.equal(d.header, 0);
  const { records } = toRecords(r.rows, d);
  assert.equal(records.find((x) => x.key === "ZZ-002").balance.text, "123456.5");
  assert.equal(records.find((x) => x.serial === "ZZ-009").balance.text, "0");
  assert.equal(csvRows("a;b;c\n1;2;3\n")[1][2], "3", "semicolon files");
  assert.deepEqual(csvRows('x,"a ""quoted"", b",y\n')[0], ["x", 'a "quoted", b', "y"]);
});

test("PDF (text): rows rebuilt from positions, a wrapped description joined, the header repeated on page 2 skipped", async () => {
  const r = await read("fake-list.pdf");
  assert.equal(r.kind, "pdf");
  const d = detectColumns(r.rows);
  assert.deepEqual(d.mapping, { serial: 0, description: 1, specification: 2, rate: 3, balance: 4 }, JSON.stringify(r.rows.slice(0, 4)));
  const { records, repeatedHeadings } = toRecords(r.rows, d);
  assert.equal(repeatedHeadings, 1);
  const by = Object.fromEntries(records.map((x) => [x.serial, x]));
  assert.deepEqual(Object.keys(by).filter(Boolean).sort(), ["ZZ-001", "ZZ-002", "ZZ-003", "ZZ-900", "ZZ-901"]);
  assert.equal(by["ZZ-002"].description, "Dummy sleeve 2 with a long description that wraps onto a second line");
  assert.equal(by["ZZ-002"].balance.text, "123456.5");
  assert.equal(by["ZZ-901"].balance.text, "2.125");
});

test("headings missing: columns are inferred from the values", () => {
  const rows = [
    ["AB-11", "Fake washer for testing", "8 mm", "12.50", "40"],
    ["AB-12", "Fake sleeve for testing", "2 mm", "3.00", "1,250"],
    ["AB-13", "Fake gasket for testing", "", "7.25", "0"],
  ];
  const d = detectColumns(rows);
  assert.equal(d.header, -1);
  assert.deepEqual(d.mapping, { serial: 0, description: 1, specification: 2, rate: 3, balance: 4 });
  assert.equal(d.how.balance, "inferred");
  assert.equal(toRecords(rows, d).records[1].balance.text, "1250");
});

test("refused, never guessed: scan, photo, macro file, old Office, wrong type, empty, oversized", async () => {
  await rejects(read("fake-scanned.pdf"), "scanned");
  await rejects(read("fake-photo.jpg"), "image");
  await rejects(read("fake-macro.xlsm"), "macro");
  await rejects(read("fake-old.xls"), "old_office");
  await rejects(readSheet(new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]), io), "unsupported"); // an .exe
  await rejects(readSheet(new Uint8Array(0), io), "empty");
  const big = new Uint8Array(LIMITS.maxBytes + 1).fill(0x41);
  await rejects(readSheet(big, io), "too_big");
  // the kind comes from the bytes: a PDF named .docx is still read as a PDF
  assert.equal(sniff(fx("fake-list.pdf")), "pdf");
  assert.equal(sniff(fx("fake-list.docx")), "zip");
});

/** A one-entry zip; `declared` lets a test lie about the size. */
function zipOf(name, data, declared = data.length) {
  const comp = deflateRawSync(data);
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(declared, 22); local.writeUInt16LE(n.length, 26);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10);
  cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(declared, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(cen.length + n.length, 12); end.writeUInt32LE(local.length + n.length + comp.length, 16);
  return new Uint8Array(Buffer.concat([local, n, comp, cen, n, end]));
}

test("zip bombs: a huge part, a part packed too tight, a part lying about its size", async () => {
  // 100 MB of zeros, honestly declared: over the per-part limit
  const zeros = Buffer.alloc(100 * 1024 * 1024);
  await rejects(Promise.resolve().then(() => zipDirectory(zipOf("word/document.xml", zeros))), "zip_bomb");
  // 30 MB packed ~1000:1: refused by the ratio before inflating
  await rejects(Promise.resolve().then(() => zipDirectory(zipOf("word/document.xml", Buffer.alloc(30 * 1024 * 1024)))), "zip_bomb");
  // declares 1 KB, inflates to 5 MB: the inflater's hard limit stops it
  const liar = zipOf("word/document.xml", Buffer.alloc(5 * 1024 * 1024), 1024);
  const [e] = zipDirectory(liar);
  await rejects(zipRead(liar, e, inflate), "zip_bomb");
});

test("XML: a DOCTYPE / ENTITY (billion laughs, external entities) is refused", () => {
  const evil = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><w:document><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>&lol2;</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;
  assert.throws(() => xmlText(new TextEncoder().encode(evil)), (e) => e.code === "unsupported");
  const ext = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><a>&xxe;</a>`;
  assert.throws(() => xmlText(new TextEncoder().encode(ext)), (e) => e.code === "unsupported");
});

test("limits: more than 5,000 rows, and the read deadline", async () => {
  const lines = ["Serial No,Material Description,Balance", ...Array.from({ length: LIMITS.maxRows + 60 }, (_, i) => `ZZ-${i},Fake item ${i},1`)];
  await rejects(readSheet(new TextEncoder().encode(lines.join("\n")), io), "too_many_rows");
  // a deadline already passed: the read stops at its first check
  await rejects(readSheet(fx("fake-list.docx"), io, deadline(-1)), "timeout");
  // 5,000 rows exactly is fine
  const ok = ["Serial No,Material Description,Balance", ...Array.from({ length: LIMITS.maxRows }, (_, i) => `ZZ-${i},Fake item ${i},1`)];
  const r = await readSheet(new TextEncoder().encode(ok.join("\n")), io);
  assert.equal(toRecords(r.rows, detectColumns(r.rows)).records.length, LIMITS.maxRows);
});

test("Word tables: merged cells keep columns in place; a nested table folds into its cell", () => {
  const xml = `<w:document><w:body><w:tbl>
    <w:tr><w:tc><w:p><w:r><w:t>Serial No</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Description</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Balance</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p><w:r><w:t>ZZ-1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>A</w:t></w:r><w:r><w:tab/><w:t>B &amp; C</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc><w:tc><w:p/></w:tc><w:tc><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc></w:tr>
  </w:tbl></w:body></w:document>`;
  const t = docxTables(xml).tables[0];
  assert.deepEqual(t[0], ["Serial No", "Description", "", "Balance"]);
  assert.equal(t[1][0], "ZZ-1");
  assert.equal(t[1][1].replace(/\s+/g, " ").trim(), "A B & C inner");
  assert.equal(t[1][3], "4");
});

test("pdfRows without a heading: columns from where cells start", () => {
  const item = (str, x, y) => ({ str, x, y, w: str.length * 5, h: 10 });
  const rows = pdfRows([[item("AB-1", 40, 500), item("Fake part one", 120, 500), item("5", 400, 500), item("AB-2", 40, 480), item("Fake part two", 120, 480), item("1,250", 400, 480)]]);
  assert.deepEqual(rows, [["AB-1", "Fake part one", "5"], ["AB-2", "Fake part two", "1,250"]]);
});

test("the app's own export layout: Closing (not Closing value) is the balance; title, total and note lines are skipped", () => {
  const rows = [
    ["NR Test Co", "", "", "", "", "", "", "", ""],
    ["Product Specification · 01/11/2026 to 30/11/2026", "", "", "", "", "", "", "", ""],
    ["Serial No", "Material Description", "Specification", "Rate (₹)", "Opening", "Received", "Issued", "Closing", "Closing value (₹)"],
    ["ZZ-1", "Fake part", "2 mm", "4.70", "13", "0", "0", "13", "61.10"],
    ["ZZ-2", "Fake part two", "", "—", "5", "1", "2", "4", "0.00"],
    ["", "", "", "", "", "", "", "", ""],
    ["Total · 2 products", "", "", "", "", "1", "2", "", "61.10"],
    ["Closing value total: active products (archived ones are listed but not counted), like the Inventory page.", "", "", "", "", "", "", "", ""],
  ];
  const d = detectColumns(rows);
  assert.equal(d.mapping.balance, 7);
  const t = toRecords(rows, d);
  assert.deepEqual(t.records.map((r) => [r.serial, r.balance.text]), [["ZZ-1", "13"], ["ZZ-2", "4"]]);
});
