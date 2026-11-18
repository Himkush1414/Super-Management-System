import "server-only";

import { zip } from "@/lib/inventory/zip";
import { paiseToText, qtyToText } from "@/lib/inventory/numbers";
import type { ExportModel } from "@/lib/inventory/export-model";

/**
 * An Excel (.xlsx) file of the export: the same rows and totals as the PDF
 * and the Word file, written directly as SpreadsheetML and zipped here (no
 * new package). Quantities, rates and values are real numbers (they add
 * up in Excel), shown with Indian digit grouping; the header row is frozen
 * and filterable.
 */

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** 0 -> A, 25 -> Z, 26 -> AA */
export function colName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// styles (cellXfs index)
const S = { text: 6, head: 1, qtyInt: 2, qtyDec: 3, inr: 4, title: 5, totalLabel: 8, totalQtyInt: 9, totalQtyDec: 10, totalInr: 7, note: 11 };

type Cell = { s: number } & ({ t: "s"; v: string } | { t: "n"; v: string } | { t: "e" });

const str = (v: string, s = S.text): Cell => ({ t: "s", v, s });
const qty = (m: bigint, total = false): Cell => {
  const v = qtyToText(m);
  const dec = v.includes(".");
  return { t: "n", v, s: total ? (dec ? S.totalQtyDec : S.totalQtyInt) : dec ? S.qtyDec : S.qtyInt };
};
const inr = (p: bigint | null, total = false): Cell => (p === null ? str("—") : { t: "n", v: paiseToText(p), s: total ? S.totalInr : S.inr });

function rowXml(r: number, cells: Cell[]): string {
  return `<row r="${r}">${cells
    .map((c, i) => {
      const ref = `${colName(i)}${r}`;
      if (c.t === "e") return `<c r="${ref}" s="${c.s}"/>`;
      if (c.t === "n") return `<c r="${ref}" s="${c.s}"><v>${c.v}</v></c>`;
      return `<c r="${ref}" s="${c.s}" t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
    })
    .join("")}</row>`;
}

export function buildXlsx(m: ExportModel, o: { company: string; subtitle: string; generated: string }): Buffer {
  const adj = m.showAdjustment;
  // one list of columns: header, width, the row cell and the total cell (empty when none)
  type Col = { head: string; width: number; cell: (x: ExportModel["rows"][number]) => Cell; total?: () => Cell };
  const cols: Col[] = [
    { head: "Serial No", width: 12, cell: (x) => str(x.serial) },
    { head: "Material Description", width: 36, cell: (x) => str(x.archived ? `${x.description} (archived)` : x.description) },
    { head: "Specification", width: 24, cell: (x) => str(x.specification || "—") },
    { head: "Rate (₹)", width: 12, cell: (x) => inr(x.rate) },
    { head: "Opening", width: 12, cell: (x) => qty(x.opening) },
    ...(adj ? [{ head: "Adjustment", width: 12, cell: (x) => qty(x.adjustment), total: () => qty(m.totals.adjustment, true) } as Col] : []),
    { head: "Received", width: 12, cell: (x) => qty(x.received), total: () => qty(m.totals.received, true) },
    { head: "Issued", width: 12, cell: (x) => qty(x.issued), total: () => qty(m.totals.issued, true) },
    // a pending balance is never written as a number
    { head: "Closing", width: 12, cell: (x) => (x.pending ? str("Pending") : qty(x.closing)) },
    { head: "Closing value (₹)", width: 16, cell: (x) => (x.pending ? str("—") : inr(x.value)), total: () => inr(m.totals.value, true) },
    ...m.customColumns.map((c, i): Col => ({ head: c.label, width: 14, cell: (x) => str(x.custom[i] ?? "") })),
  ];
  const head = cols.map((c) => c.head);
  const widths = cols.map((c) => c.width);
  const last = colName(head.length - 1);
  const HEAD_ROW = 5;

  const rows: string[] = [];
  rows.push(rowXml(1, [str(o.company, S.title)]));
  rows.push(rowXml(2, [str(`Product Specification · ${o.subtitle}`, S.note)]));
  rows.push(rowXml(3, [str(`Generated: ${o.generated}${m.person ? ` · Inventory: ${m.person}` : ""}`, S.note)]));
  rows.push(rowXml(HEAD_ROW, head.map((h) => str(h, S.head))));
  let r = HEAD_ROW + 1;
  for (const x of m.rows) rows.push(rowXml(r++, cols.map((c) => c.cell(x))));
  const totalRow = r + 1;
  const totalCells: Cell[] = cols
    .map((c, i) => (i === 0 ? str(`Total · ${m.rows.length} products`, S.totalLabel) : c.total ? c.total() : ({ t: "e", s: S.totalLabel } as Cell)))
    // the total row stops after the value column, as before
    .slice(0, cols.findIndex((c) => c.head === "Closing value (₹)") + 1);
  rows.push(rowXml(totalRow, totalCells));
  const notes = ["Closing value total: active products (archived ones are listed but not counted), like the Inventory page."];
  if (m.counts.pending) notes.push(`${m.counts.confirmed} of ${m.counts.active} active products confirmed this month; "Pending" balances are not counted yet and not in the value.`);
  if (adj) notes.push("Opening + Adjustment + Received − Issued = Closing. Adjustment = stock counts (counted balance − balance before).");
  notes.forEach((n, i) => rows.push(rowXml(totalRow + 1 + i, [str(n, S.note)])));
  const lastRow = totalRow + notes.length;

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:${last}${lastRow}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${HEAD_ROW}" topLeftCell="A${HEAD_ROW + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${rows.join("")}</sheetData>` +
    `<autoFilter ref="A${HEAD_ROW}:${last}${Math.max(HEAD_ROW, HEAD_ROW + m.rows.length)}"/>` +
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
    `<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>` +
    `</worksheet>`;

  // Indian grouping: 1,23,45,678.90
  const IN_INT = `[&gt;=10000000]##\\,##\\,##\\,##0;[&gt;=100000]##\\,##\\,##0;##,##0`;
  const IN_DEC = `[&gt;=10000000]##\\,##\\,##\\,##0.0##;[&gt;=100000]##\\,##\\,##0.0##;##,##0.0##`;
  const IN_INR = `[&gt;=10000000]&quot;₹&quot;##\\,##\\,##\\,##0.00;[&gt;=100000]&quot;₹&quot;##\\,##\\,##0.00;&quot;₹&quot;##,##0.00`;
  const thin = `<border><left style="thin"><color rgb="FFCBD2DC"/></left><right style="thin"><color rgb="FFCBD2DC"/></right><top style="thin"><color rgb="FFCBD2DC"/></top><bottom style="thin"><color rgb="FFCBD2DC"/></bottom><diagonal/></border>`;
  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="3"><numFmt numFmtId="164" formatCode="${IN_INT}"/><numFmt numFmtId="165" formatCode="${IN_DEC}"/><numFmt numFmtId="166" formatCode="${IN_INR}"/></numFmts>` +
    `<fonts count="4"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FF1B2F6B"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF1B2F6B"/><name val="Calibri"/></font><font><sz val="9"/><color rgb="FF555555"/><name val="Calibri"/></font></fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F8"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${thin}</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="12">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` + // 0 default
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment wrapText="1" vertical="center"/></xf>` + // 1 head
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>` + // 2 qty int
    `<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>` + // 3 qty dec
    `<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>` + // 4 inr
    `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` + // 5 title
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>` + // 6 text
    `<xf numFmtId="166" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>` + // 7 total inr
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>` + // 8 total label
    `<xf numFmtId="164" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>` + // 9 total qty int
    `<xf numFmtId="165" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>` + // 10 total qty dec
    `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>` + // 11 note
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="Product Specification" sheetId="1" r:id="rId1"/></sheets>` +
    `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'Product Specification'!$A$${HEAD_ROW}:$${last}$${Math.max(HEAD_ROW, HEAD_ROW + m.rows.length)}</definedName>` +
    `<definedName name="_xlnm.Print_Titles" localSheetId="0">'Product Specification'!$${HEAD_ROW}:$${HEAD_ROW}</definedName></definedNames>` +
    `</workbook>`;

  return zip([
    {
      name: "[Content_Types].xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    },
    {
      name: "docProps/core.xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
        `<dc:title>${esc(m.title)}</dc:title><dc:creator>${esc(o.company)}</dc:creator></cp:coreProperties>`,
    },
    { name: "xl/workbook.xml", data: workbook },
    {
      name: "xl/_rels/workbook.xml.rels",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "xl/worksheets/sheet1.xml", data: sheet },
    { name: "xl/styles.xml", data: styles },
  ]);
}
