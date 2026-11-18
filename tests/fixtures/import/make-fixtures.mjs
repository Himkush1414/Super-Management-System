// Builds the FAKE import fixtures in this folder (fake serials ZZ-…, made-up
// names): node --experimental-strip-types tests/fixtures/import/make-fixtures.mjs
// Re-running gives the same files. A zip bomb and an oversized file are made
// by the tests at run time instead (never stored).
import "../../helpers/alias.mjs";
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const { buildDocx } = await import("../../../lib/inventory/docx.ts");
const { zip } = await import("../../../lib/inventory/zip.ts");
const out = (name, data) => writeFileSync(join(HERE, name), data);
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");
const docx = (head, rows, widths) =>
  buildDocx({ title: "Fake list", subtitle: "Test fixture", generated: "01/12/2026", company: "Fake Co", address: ["1 Sample Road"], logo: { jpeg: JPEG, aspect: 1 },
    summary: ["Fake data"], head, right: head.map(() => false), rows, widths: widths ?? head.map(() => 10), totalLine: "End" });

// 1. the earlier script's layout: Sr No … Opening, receipt cells 1–3, issue cells 1–2, Closing
out("fake-legacy.docx", docx(
  ["Sr No", "Material Description", "Specification", "Rate", "UOM", "Opening Balance", "Receipt", "", "", "Issue", "", "Closing Balance"],
  [
    ["", "", "", "", "", "", "1", "2", "3", "1", "2", ""],
    ["ZZ-501", "Dummy bracket", "10 mm", "12.50", "Nos.", "10", "5", "", "", "3", "", "12"],
    ["ZZ-502", " Sample  gasket ", "2 mm", "", "Kg", "4.5", "", "", "", "0.5", "", "4"],
    ["ZZ-503", "Demo sleeve", "", "3", "Nos.", "0", "2", "1", "", "", "", "3"],
  ],
));

// 2. a plain list (Word): matched, new, duplicates, problems, Indian numbers
const LIST_HEAD = ["Serial No", "Material Description", "Specification", "Rate", "Balance"];
const LIST = [
  ["ZZ-001", "Sample washer plate 1", "2 mm", "4.70", "13"],
  ["zz- 002", "Dummy sleeve 2", "", "8.40", "1,23,456.50"], // spaces + case in the serial ("zz- 002" = "ZZ-002"); Indian grouping
  ["ZZ-003", "Demo bolt kit 3", "4 mm", "", "0"],
  ["", "Test gasket 4", "", "", "7"], // no serial: unique description
  ["ZZ-900", "Fake new part", "6 mm", "99.00", "5"], // new product
  ["ZZ-901", "Fake second new part", "", "", "2.125"],
  ["ZZ-902", "", "", "", "1"], // new without description: problem
  ["ZZ-005", "Sample cable lug 5", "", "", "-3"], // negative: problem
  ["ZZ-006", "Sample washer plate 6", "", "", ""], // blank: problem
  ["ZZ-007", "Dummy sleeve 7", "", "", "abc"], // unreadable: problem
  ["ZZ-008", "Demo bolt kit 8", "", "", "4"],
  ["ZZ-008", "Demo bolt kit 8 again", "", "", "4"], // duplicate in the file: problem (both)
  ["ZZ-903", "=1+1", "@cmd", "", "1"], // text that looks like a formula: kept as text
];
out("fake-list.docx", docx(LIST_HEAD, LIST));

// 3. CSV: BOM, quotes, Indian grouping, a tiny float
const csv = "﻿" + [LIST_HEAD, ...LIST.slice(0, 6), ["ZZ-009", "Test gasket 9", "", "", "1E-13"]]
  .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n") + "\r\n";
out("fake-list.csv", Buffer.from(csv, "utf8"));

// 4. Excel with shared strings, numbers, a formula WITH a saved value, one WITHOUT, a 1E-13 leftover, a hidden sheet
const strings = [...new Set([...LIST_HEAD, ...LIST.slice(0, 6).flatMap((r) => [r[0], r[1], r[2]]).filter(Boolean), "ZZ-904", "Hidden"])];
const si = (s) => strings.indexOf(s);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const col = (i) => String.fromCharCode(65 + i);
const cellXml = (ref, v) => {
  if (v === null || v === "") return "";
  if (typeof v === "object" && v.raw) return `<c r="${ref}"><v>${v.raw}</v></c>`; // a number exactly as Excel wrote it
  if (typeof v === "object") return v.f ? `<c r="${ref}"><f>${esc(v.f)}</f>${v.v !== undefined ? `<v>${v.v}</v>` : ""}</c>` : `<c r="${ref}" t="inlineStr"><is><t>${esc(v.inline)}</t></is></c>`;
  if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
  return `<c r="${ref}" t="s"><v>${si(v)}</v></c>`;
};
const sheetRows = [
  LIST_HEAD,
  ["ZZ-001", "Sample washer plate 1", "2 mm", 4.7, 13],
  ["zz- 002", "Dummy sleeve 2", "", 8.4, 123456.5],
  ["ZZ-003", "Demo bolt kit 3", "4 mm", null, { f: "B9-B9", v: "1.0000000000000001E-13" }], // a leftover from x − x
  ["", "Test gasket 4", "", null, 7],
  ["ZZ-900", "Fake new part", "6 mm", 99, { f: "2+3", v: "5" }], // formula with its saved value
  ["ZZ-901", "Fake second new part", "", null, { f: "SUM(Z1:Z9)" }], // formula, no saved value -> empty (never calculated)
  ["ZZ-904", { inline: "Inline text part" }, "", { raw: "12.300000000000001" }, 6], // binary noise, as Excel saves it
];
const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows
  .map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cellXml(`${col(ci)}${ri + 1}`, v)).join("")}</row>`).join("")}</sheetData></worksheet>`;
const hidden = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>${si("Hidden")}</v></c></row></sheetData></worksheet>`;
const sst = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`;
const xlsxParts = (extra = [], macro = false) => [
  { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.${macro ? "ms-excel.sheet.macroEnabled.main+xml" : "openxmlformats-officedocument.spreadsheetml.sheet.main+xml"}"/></Types>` },
  { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
  { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Hidden one" sheetId="2" state="hidden" r:id="rId2"/><sheet name="Stock" sheetId="1" r:id="rId1"/></sheets></workbook>` },
  { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>` },
  { name: "xl/worksheets/sheet1.xml", data: sheet1 },
  { name: "xl/worksheets/sheet2.xml", data: hidden },
  { name: "xl/sharedStrings.xml", data: sst },
  ...extra,
];
out("fake-list.xlsx", zip(xlsxParts()));
out("fake-macro.xlsm", zip(xlsxParts([{ name: "xl/vbaProject.bin", data: Buffer.from("fake, not a real macro project") }], true)));

// 5. a text PDF: Helvetica, a header and rows in columns, one description wrapping onto a second line
function pdf(pageStreams, { image = false } = {}) {
  const objs = [];
  const add = (s) => objs.push(s) && objs.length;
  const catalog = add(null);
  const pagesId = add(null);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const img = image ? add(null) : 0;
  const kids = [];
  for (const content of pageStreams) {
    const z = deflateSync(Buffer.from(content, "latin1")); // /FlateDecode = a zlib stream
    const sid = add(`<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n${z.toString("latin1")}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${font} 0 R >>${image ? ` /XObject << /Im1 ${img} 0 R >>` : ""} >> /Contents ${sid} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  if (image) {
    const px = Buffer.alloc(16 * 16 * 3, 0x88);
    objs[img - 1] = `<< /Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${px.length} >>\nstream\n${px.toString("latin1")}\nendstream`;
  }
  let body = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
const X = [40, 120, 330, 470, 560];
const text = (x, y, s, size = 10) => `BT /F1 ${size} Tf ${x} ${y} Td (${s.replace(/[()\\]/g, "\\$&")}) Tj ET\n`;
let page1 = text(40, 560, "Fake Co: product list (fake data)", 12);
page1 += LIST_HEAD.map((h, i) => text(X[i], 520, h)).join("");
const pdfRows = [
  ["ZZ-001", "Sample washer plate 1", "2 mm", "4.70", "13"],
  ["ZZ-002", "Dummy sleeve 2 with a long description", "3 mm", "8.40", "1,23,456.50"],
  [null, "that wraps onto a second line", null, null, null],
  ["ZZ-900", "Fake new part", "6 mm", "99.00", "5"],
  ["ZZ-003", "Demo bolt kit 3", "", "", "0"],
];
let y = 500;
let lastY = y;
for (const r of pdfRows) {
  // a wrapped description sits one text line (11 pt) under its row; rows are 20 pt apart
  const at = r[0] === null ? lastY - 11 : y;
  r.forEach((c, i) => {
    if (c) page1 += text(X[i] + (i >= 3 ? 40 - c.length * 5 : 0), at, c);
  });
  lastY = at;
  y = at - 20;
}
let page2 = LIST_HEAD.map((h, i) => text(X[i], 520, h)).join(""); // the header repeats on page 2
page2 += ["ZZ-901", "Fake second new part", "", "", "2.125"].map((c, i) => (c ? text(X[i] + (i >= 3 ? 40 - c.length * 5 : 0), 500, c) : "")).join("");
out("fake-list.pdf", pdf([page1, page2]));
// 6. a scan: one page holding a picture and no text at all
out("fake-scanned.pdf", pdf(["q 600 0 0 400 100 100 cm /Im1 Do Q\n"], { image: true }));
// 7. a photo, an old Excel file (binary), a file of another kind
out("fake-photo.jpg", JPEG);
out("fake-old.xls", Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]));
console.log("fake fixtures written");
