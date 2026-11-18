/**
 * lib/inventory/sheet-read.ts — reads a product list out of an UNTRUSTED file:
 * a text-based PDF (its text items, from pdf.js), Word (.docx), Excel (.xlsx)
 * or CSV, into plain rows of cell text. Shared by the browser ("Import from
 * document"), the tests and scripts/inventory/import-docx.mjs.
 *
 * Hardened on purpose:
 *   - the kind is decided by the bytes, never the file name;
 *   - zip: entry count, per-entry and total sizes and the compression ratio
 *     are capped, the inflater is handed a hard output limit (a lying header
 *     can't get past it), encrypted entries and anything but stored/deflate
 *     are refused, and only the few parts we need are ever inflated;
 *   - macro-enabled files (.docm/.xlsm, vbaProject.bin) and old binary
 *     Office files are refused; photos and scans are recognised, never guessed;
 *   - XML: a DOCTYPE or ENTITY is refused (no entity expansion, no external
 *     entities); parsing is a single linear scan (no backtracking regex);
 *   - spreadsheet formulas are NEVER evaluated: the value the spreadsheet
 *     saved is read, or nothing;
 *   - everything checks a deadline, so a hostile file can't hang the page.
 * Nothing here stores, logs or sends the file or its name.
 *
 * No imports: node --test and the import script load this file directly.
 * The inflater is passed in (the browser's DecompressionStream, Node's zlib).
 */

export type FileKind = "pdf" | "docx" | "xlsx" | "csv";

export class SheetError extends Error {
  /** a stable reason for the screen: never contains file content */
  code: SheetErrorCode;
  constructor(code: SheetErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
export type SheetErrorCode =
  | "too_big" | "empty" | "image" | "scanned" | "macro" | "old_office" | "encrypted" | "unsupported"
  | "zip_bomb" | "corrupt" | "timeout" | "too_many_rows" | "no_table";

/** Limits for one import. */
export const LIMITS = {
  /** the file itself */
  maxBytes: 4 * 1024 * 1024,
  /** rows of data (after the header) */
  maxRows: 5000,
  maxColumns: 60,
  /** zip */
  maxEntries: 2000,
  maxEntryBytes: 40 * 1024 * 1024,
  maxTotalBytes: 80 * 1024 * 1024,
  /** a part larger than 1 MB may not be compressed more than this (a zip bomb is ~1000:1) */
  maxRatio: 250,
  /** whole read */
  timeoutMs: 20_000,
  /** one cell */
  maxCellChars: 2000,
};

export type Inflate = (data: Uint8Array, maxOut: number) => Promise<Uint8Array>;

/** A deadline: throws "timeout" once passed. */
export function deadline(ms = LIMITS.timeoutMs) {
  const end = Date.now() + ms;
  return () => {
    if (Date.now() > end) throw new SheetError("timeout", "The file took too long to read.");
  };
}

// ── what is it? ─────────────────────────────────────────────────────────

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);

/** The file's kind from its first bytes (never the name). */
export function sniff(b: Uint8Array): "pdf" | "zip" | "ole" | "image" | "text" | "binary" | "empty" {
  if (b.length === 0) return "empty";
  // %PDF- may follow a little junk (allowed by the spec: within the first 1 KB)
  const head = latin1(b.subarray(0, Math.min(b.length, 1024)));
  if (head.includes("%PDF-")) return "pdf";
  if (starts(b, [0x50, 0x4b, 0x03, 0x04]) || starts(b, [0x50, 0x4b, 0x05, 0x06])) return "zip";
  if (starts(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole"; // .doc/.xls, or an encrypted .docx/.xlsx
  if (
    starts(b, [0xff, 0xd8, 0xff]) || // JPEG
    starts(b, [0x89, 0x50, 0x4e, 0x47]) || // PNG
    starts(b, [0x47, 0x49, 0x46, 0x38]) || // GIF
    starts(b, [0x49, 0x49, 0x2a, 0x00]) || starts(b, [0x4d, 0x4d, 0x00, 0x2a]) || // TIFF
    starts(b, [0x42, 0x4d]) || // BMP
    (starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8)) || // WEBP
    (latin1(b.subarray(4, 12)).startsWith("ftyp") && /heic|heix|mif1|avif/.test(latin1(b.subarray(8, 12)))) // HEIC / AVIF
  ) {
    return "image";
  }
  // text: no NUL bytes in the first 8 KB (UTF-16 has a BOM)
  if (starts(b, [0xff, 0xfe]) || starts(b, [0xfe, 0xff])) return "text";
  const sample = b.subarray(0, Math.min(b.length, 8192));
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) return "binary";
  return "text";
}

function latin1(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

const utf8 = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);

// ── zip (Word and Excel files are zips) ─────────────────────────────────

export interface ZipEntry {
  name: string;
  method: number;
  compressed: number;
  size: number;
  offset: number;
  encrypted: boolean;
}

/** The zip's directory, checked against the limits. Nothing is inflated yet. */
export function zipDirectory(b: Uint8Array): ZipEntry[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // end of central directory: in the last 64 KB + 22 bytes
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SheetError("corrupt", "The file is damaged or not a Word/Excel file.");
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  let p = dv.getUint32(eocd + 16, true);
  if (count > LIMITS.maxEntries) throw new SheetError("zip_bomb", "The file has too many parts to be a product list.");
  if (p + cdSize > b.length) throw new SheetError("corrupt", "The file is damaged.");
  const out: ZipEntry[] = [];
  let total = 0;
  for (let k = 0; k < count; k++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) throw new SheetError("corrupt", "The file is damaged.");
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const compressed = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    if (p + 46 + nameLen > b.length) throw new SheetError("corrupt", "The file is damaged.");
    const name = utf8(b.subarray(p + 46, p + 46 + nameLen));
    // zip64 markers (0xFFFFFFFF) mean parts over 4 GB: never a product list
    if (compressed === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new SheetError("zip_bomb", "The file is far too large inside.");
    if (size > LIMITS.maxEntryBytes) throw new SheetError("zip_bomb", "A part of the file is too large to be a product list.");
    if (size > 1024 * 1024 && compressed > 0 && size / compressed > LIMITS.maxRatio) throw new SheetError("zip_bomb", "The file is packed suspiciously tight (a zip bomb?).");
    total += size;
    if (total > LIMITS.maxTotalBytes) throw new SheetError("zip_bomb", "The file is too large inside.");
    out.push({ name, method, compressed, size, offset, encrypted: (flags & 1) === 1 });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** One part's bytes, inflated with a hard output limit. */
export async function zipRead(b: Uint8Array, e: ZipEntry, inflate: Inflate): Promise<Uint8Array> {
  if (e.encrypted) throw new SheetError("encrypted", "The file is password-protected.");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (e.offset + 30 > b.length || dv.getUint32(e.offset, true) !== 0x04034b50) throw new SheetError("corrupt", "The file is damaged.");
  const start = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
  if (start + e.compressed > b.length) throw new SheetError("corrupt", "The file is damaged.");
  const data = b.subarray(start, start + e.compressed);
  if (e.method === 0) return data;
  if (e.method !== 8) throw new SheetError("unsupported", "The file uses a packing method this reader doesn't accept.");
  // the limit is the declared size (capped): an entry that inflates past it is refused
  const out = await inflate(data, Math.min(e.size, LIMITS.maxEntryBytes));
  if (out.length > e.size) throw new SheetError("zip_bomb", "A part of the file is larger than it says.");
  return out;
}

/** Word, Excel, a macro file, or something else — from [Content_Types].xml and the part names. */
export async function officeKind(b: Uint8Array, entries: ZipEntry[], inflate: Inflate): Promise<"docx" | "xlsx"> {
  const names = new Set(entries.map((e) => e.name));
  if ([...names].some((n) => /(^|\/)vbaProject\.bin$/i.test(n) || /(^|\/)vbaData\.xml$/i.test(n))) {
    throw new SheetError("macro", "The file contains macros. Save it as a normal .docx / .xlsx and try again.");
  }
  const ct = entries.find((e) => e.name === "[Content_Types].xml");
  if (!ct) throw new SheetError("unsupported", "The file is not a Word or Excel document.");
  const types = xmlText(await zipRead(b, ct, inflate));
  if (/macroEnabled/i.test(types)) throw new SheetError("macro", "The file is macro-enabled (.docm / .xlsm). Save it as .docx / .xlsx and try again.");
  if (types.includes("wordprocessingml.document.main+xml") && names.has("word/document.xml")) return "docx";
  if (types.includes("spreadsheetml.sheet.main+xml") && names.has("xl/workbook.xml")) return "xlsx";
  if (/presentationml/.test(types)) throw new SheetError("unsupported", "A PowerPoint file can't be imported. Use Word, Excel, PDF or CSV.");
  throw new SheetError("unsupported", "The file is not a Word or Excel document.");
}

// ── XML (one linear pass, no DTDs, no entities) ─────────────────────────

/** XML bytes as text; a DOCTYPE or ENTITY declaration is refused. */
export function xmlText(b: Uint8Array): string {
  const s = utf8(b);
  if (/<!DOCTYPE|<!ENTITY/i.test(s.slice(0, 4096)) || s.includes("<!ENTITY")) {
    throw new SheetError("unsupported", "The file contains XML features this reader refuses.");
  }
  return s;
}

const ENT: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
/** The five XML entities and numeric references; anything else is left as written. */
export function xmlDecode(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|lt|gt|amp|quot|apos);/g, (m, e: string) => {
    if (e[0] !== "#") return ENT[e];
    const n = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
  });
}

type Tag = { name: string; close: boolean; self: boolean; attrs: string; start: number; end: number };

/** Every tag of an XML text, in order (comments, PIs and CDATA skipped). Linear. */
function* tags(xml: string, check: () => void): Generator<Tag> {
  let i = 0;
  let n = 0;
  while (true) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) return;
    if (++n % 20000 === 0) check();
    if (xml.startsWith("<!--", lt)) {
      const e = xml.indexOf("-->", lt + 4);
      i = e < 0 ? xml.length : e + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const e = xml.indexOf("]]>", lt + 9);
      i = e < 0 ? xml.length : e + 3;
      continue;
    }
    if (xml[lt + 1] === "?" || xml[lt + 1] === "!") {
      const e = xml.indexOf(">", lt + 2);
      i = e < 0 ? xml.length : e + 1;
      continue;
    }
    const gt = xml.indexOf(">", lt + 1);
    if (gt < 0) return;
    const close = xml[lt + 1] === "/";
    const self = xml[gt - 1] === "/";
    const body = xml.slice(lt + (close ? 2 : 1), self ? gt - 1 : gt);
    const sp = body.search(/[\s/]/);
    const name = sp < 0 ? body : body.slice(0, sp);
    yield { name, close, self, attrs: sp < 0 ? "" : body.slice(sp), start: lt, end: gt + 1 };
    i = gt + 1;
  }
}

const attr = (attrs: string, name: string): string | null => {
  const m = new RegExp(`(?:^|\\s)${name.replace(":", "\\:")}="([^"]*)"`).exec(attrs);
  return m ? xmlDecode(m[1]) : null;
};

const cell = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > LIMITS.maxCellChars ? t.slice(0, LIMITS.maxCellChars) : t;
};

// ── Word ────────────────────────────────────────────────────────────────

export interface DocxRead {
  tables: string[][][];
  /** text outside tables, and pictures: to tell a scan apart from an empty file */
  textChars: number;
  pictures: number;
}

/**
 * Tables of a Word document (word/document.xml), rows of cell text exactly as
 * written (a cell's paragraphs joined by a space, tabs and line breaks read
 * as spaces, not trimmed: callers clean it). A cell spanning columns is
 * followed by empty cells. A table inside a cell folds into that cell.
 */
export function docxTables(xml: string, check = deadline()): DocxRead {
  const tables: string[][][] = [];
  let depth = 0;
  let table: string[][] | null = null;
  let row: string[] | null = null;
  let cellDepth = 0;
  let paras: string[] = [];
  let para: string[] = [];
  let inT = false;
  let span = 1;
  let textChars = 0;
  let pictures = 0;
  let lastEnd = 0;
  let rows = 0;
  for (const t of tags(xml, check)) {
    if (inT && t.start > lastEnd) {
      const chunk = xmlDecode(xml.slice(lastEnd, t.start));
      textChars += chunk.trim().length;
      if (cellDepth > 0) para.push(chunk);
    }
    lastEnd = t.end;
    switch (t.name) {
      case "w:tbl":
        if (t.self) break;
        if (t.close) {
          depth--;
          if (depth === 0 && table) {
            tables.push(table);
            table = null;
          }
        } else {
          depth++;
          if (depth === 1) table = [];
        }
        break;
      case "w:tr":
        if (depth !== 1 || t.self) break;
        if (!t.close) row = [];
        else if (row && table) {
          if (++rows > LIMITS.maxRows + 50) throw new SheetError("too_many_rows", `The file has more than ${LIMITS.maxRows} rows.`);
          table.push(row);
          row = null;
        }
        break;
      case "w:tc":
        if (t.self) break;
        if (t.close) {
          cellDepth--;
          if (cellDepth === 0 && depth === 1 && row) {
            if (para.length) paras.push(para.join(""));
            const text = paras.join(" ");
            row.push(text.length > LIMITS.maxCellChars ? text.slice(0, LIMITS.maxCellChars) : text);
            for (let k = 1; k < span && row.length < LIMITS.maxColumns; k++) row.push("");
          }
        } else {
          cellDepth++;
          if (cellDepth === 1) {
            span = 1;
            paras = [];
            para = [];
          }
        }
        break;
      case "w:gridSpan":
        if (cellDepth === 1) span = Math.max(1, Math.min(LIMITS.maxColumns, Number(attr(t.attrs, "w:val") ?? 1) || 1));
        break;
      case "w:p":
        if (cellDepth > 0 && !t.self) {
          if (!t.close) para = [];
          else {
            paras.push(para.join(""));
            para = [];
          }
        }
        break;
      case "w:t":
        inT = !t.close && !t.self;
        break;
      case "w:tab":
      case "w:br":
      case "w:cr":
        if (cellDepth > 0) para.push(" ");
        break;
      case "w:drawing":
      case "w:pict":
      case "v:imagedata":
        if (!t.close) pictures++;
        break;
    }
  }
  return { tables, textChars, pictures };
}

// ── Excel ───────────────────────────────────────────────────────────────

/** "B12" -> column 1 (0-based); null for a bad reference. */
export function colIndex(ref: string): number | null {
  const m = /^([A-Z]{1,3})\d*$/.exec(ref);
  if (!m) return null;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Shared strings (xl/sharedStrings.xml): plain and rich text (phonetic hints skipped). */
export function xlsxSharedStrings(xml: string, check = deadline()): string[] {
  const out: string[] = [];
  let cur: string[] | null = null;
  let inT = false;
  let inPhonetic = false;
  let lastEnd = 0;
  for (const t of tags(xml, check)) {
    if (inT && !inPhonetic && cur && t.start > lastEnd) cur.push(xml.slice(lastEnd, t.start));
    lastEnd = t.end;
    if (t.name === "si") {
      if (!t.close && !t.self) cur = [];
      else if (t.self) out.push("");
      else if (cur) {
        out.push(xmlDecode(cur.join("")));
        cur = null;
      }
    } else if (t.name === "t") inT = !t.close && !t.self;
    else if (t.name === "rPh") inPhonetic = !t.close && !t.self;
    if (out.length > 1_000_000) throw new SheetError("too_many_rows", "The file has too many cells.");
  }
  return out;
}

export interface XlsxSheetRef {
  name: string;
  path: string;
  hidden: boolean;
}

/** The workbook's sheets in order, with their part path. */
export function xlsxSheets(workbookXml: string, relsXml: string, check = deadline()): XlsxSheetRef[] {
  const rels = new Map<string, string>();
  for (const t of tags(relsXml, check)) {
    if (t.name !== "Relationship" || t.close) continue;
    const id = attr(t.attrs, "Id");
    const target = attr(t.attrs, "Target");
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`.replace(/\/\.\//g, "/"));
  }
  const out: XlsxSheetRef[] = [];
  for (const t of tags(workbookXml, check)) {
    if (t.name !== "sheet" || t.close) continue;
    const id = attr(t.attrs, "r:id");
    const path = id ? rels.get(id) : undefined;
    if (!path) continue;
    out.push({ name: attr(t.attrs, "name") ?? "Sheet", path: path.replace(/^xl\/xl\//, "xl/"), hidden: /hidden/.test(attr(t.attrs, "state") ?? "") });
  }
  return out;
}

export interface XlsxRead {
  rows: string[][];
  /** formulas whose saved value was missing (read as empty) */
  formulasWithoutValue: number;
}

/**
 * One worksheet as rows of cell text. Numbers are kept as written in the
 * file (so "1E-13" stays visible to the number reader). A formula is NOT
 * evaluated: its cached value <v> is read; without one the cell is empty.
 */
export function xlsxRows(xml: string, shared: string[], check = deadline()): XlsxRead {
  const rows: string[][] = [];
  let r: string[] | null = null;
  let rowIndex = -1;
  let col = -1;
  let type = "";
  let value: string | null = null;
  let inline: string[] | null = null;
  let hasF = false;
  let inV = false;
  let inIsT = false;
  let lastEnd = 0;
  let missing = 0;
  const put = () => {
    if (!r || col < 0 || col >= LIMITS.maxColumns) return;
    let v = "";
    if (type === "s") v = value !== null ? (shared[Number(value)] ?? "") : "";
    else if (type === "inlineStr") v = inline ? xmlDecode(inline.join("")) : "";
    else if (type === "b") v = value === "1" ? "TRUE" : value === "0" ? "FALSE" : "";
    else if (type === "e") v = "";
    else v = value !== null ? xmlDecode(value) : "";
    if (hasF && value === null && type !== "inlineStr") missing++;
    while (r.length < col) r.push("");
    r[col] = cell(v);
  };
  for (const t of tags(xml, check)) {
    if (inV && t.start > lastEnd) value = (value ?? "") + xml.slice(lastEnd, t.start);
    if (inIsT && inline && t.start > lastEnd) inline.push(xml.slice(lastEnd, t.start));
    lastEnd = t.end;
    switch (t.name) {
      case "row":
        if (!t.close) {
          const n = Number(attr(t.attrs, "r") ?? rowIndex + 2) - 1;
          rowIndex = Number.isFinite(n) && n > rowIndex ? n : rowIndex + 1;
          // empty rows in between keep the row numbers honest
          while (rows.length < rowIndex) rows.push([]);
          if (rows.length > LIMITS.maxRows + 50) throw new SheetError("too_many_rows", `The file has more than ${LIMITS.maxRows} rows.`);
          r = [];
          col = -1;
          if (t.self) {
            rows.push(r);
            r = null;
          }
        } else if (r) {
          rows.push(r);
          r = null;
        }
        break;
      case "c":
        if (!t.close) {
          const ref = attr(t.attrs, "r");
          col = ref ? (colIndex(ref.replace(/\d+$/, "")) ?? col + 1) : col + 1;
          type = attr(t.attrs, "t") ?? "n";
          value = null;
          inline = null;
          hasF = false;
          if (t.self) put();
        } else put();
        break;
      case "f":
        if (!t.close) hasF = true;
        break;
      case "v":
        inV = !t.close && !t.self;
        if (!t.close && !t.self) value = "";
        break;
      case "is":
        if (!t.close && !t.self) inline = [];
        break;
      case "t":
        if (inline) inIsT = !t.close && !t.self;
        break;
    }
  }
  return { rows, formulasWithoutValue: missing };
}

// ── CSV ─────────────────────────────────────────────────────────────────

/** Bytes of a text file as a string (UTF-8, or UTF-16 with a BOM). */
export function decodeText(b: Uint8Array): string {
  if (starts(b, [0xff, 0xfe])) return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (starts(b, [0xfe, 0xff])) return new TextDecoder("utf-16be").decode(b.subarray(2));
  const s = utf8(b);
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** CSV rows (RFC 4180 quotes); the delimiter (, ; tab |) is found from the first lines. */
export function csvRows(text: string, check = deadline()): string[][] {
  const firstLines = text.slice(0, 20000).split(/\r?\n/).slice(0, 20);
  const delims = [",", ";", "\t", "|"];
  const score = (d: string) => {
    const counts = firstLines.filter((l) => l.trim()).map((l) => l.split(d).length - 1);
    if (!counts.length) return 0;
    const same = counts.filter((c) => c === counts[0]).length;
    return counts[0] > 0 ? counts[0] * 10 + same : 0;
  };
  const delim = delims.reduce((best, d) => (score(d) > score(best) ? d : best), ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if ((i & 0xffff) === 0) check();
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) {
      row.push(cell(field));
      field = "";
      if (row.length > LIMITS.maxColumns) row.length = LIMITS.maxColumns;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell(field));
      rows.push(row);
      if (rows.length > LIMITS.maxRows + 50) throw new SheetError("too_many_rows", `The file has more than ${LIMITS.maxRows} rows.`);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(cell(field));
    rows.push(row);
  }
  return rows;
}

// ── PDF (text items from pdf.js -> rows) ────────────────────────────────

/** One piece of text on a PDF page, in PDF units (y grows upwards). */
export interface PdfItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Rebuild table rows from a text-based PDF's text pieces: pieces on the same
 * baseline form a line; a gap wider than the font size starts a new cell.
 * Columns are then lined up by the header line when there is one (each
 * piece goes to the column whose header it sits under), else by where the
 * cells start. A line whose first column is empty (a description wrapping
 * onto a second line) is joined to the line above.
 */
export function pdfRows(pages: PdfItem[][], check = deadline()): string[][] {
  const lines: { y: number; cells: { x0: number; x1: number; text: string }[] }[] = [];
  for (const items of pages) {
    check();
    const sorted = items.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
    const pageLines: { y: number; h: number; items: PdfItem[] }[] = [];
    for (const it of sorted) {
      const l = pageLines.find((pl) => Math.abs(pl.y - it.y) <= Math.max(2, Math.min(pl.h, it.h) * 0.45));
      if (l) l.items.push(it);
      else pageLines.push({ y: it.y, h: it.h || 8, items: [it] });
    }
    for (const pl of pageLines.sort((a, b) => b.y - a.y)) {
      const its = pl.items.sort((a, b) => a.x - b.x);
      const cells: { x0: number; x1: number; text: string }[] = [];
      for (const it of its) {
        const last = cells[cells.length - 1];
        const gap = last ? it.x - last.x1 : Infinity;
        if (last && gap < Math.max(3, (it.h || 8) * 0.9)) {
          last.text += (gap > (it.h || 8) * 0.15 ? " " : "") + it.str;
          last.x1 = Math.max(last.x1, it.x + it.w);
        } else cells.push({ x0: it.x, x1: it.x + it.w, text: it.str });
      }
      lines.push({ y: pl.y, cells });
      if (lines.length > (LIMITS.maxRows + 50) * 3) throw new SheetError("too_many_rows", `The file has more than ${LIMITS.maxRows} rows.`);
    }
  }
  if (!lines.length) return [];
  // the header line: the first with a serial heading and at least 3 cells
  const isHead = (cells: { text: string }[]) => cells.length >= 3 && cells.some((c) => SERIAL_HEAD.test(c.text.replace(/\s+/g, " ").trim()));
  const hi = lines.findIndex((l) => isHead(l.cells));
  // columns: the header's cells (their text spans), or, without a header, where cells start
  let spans: { x0: number; x1: number }[];
  if (hi >= 0) {
    spans = lines[hi].cells.map((c) => ({ x0: c.x0, x1: c.x1 }));
  } else {
    const starts = lines.filter((l) => l.cells.length >= 2).flatMap((l) => l.cells.map((c) => c.x0)).sort((a, b) => a - b);
    const anchors: number[] = [];
    for (const x of starts) if (!anchors.length || x - anchors[anchors.length - 1] > 12) anchors.push(x);
    spans = anchors.map((x, k) => ({ x0: x, x1: k + 1 < anchors.length ? anchors[k + 1] - 6 : x + 60 }));
  }
  if (spans.length > LIMITS.maxColumns) spans = spans.slice(0, LIMITS.maxColumns);
  /**
   * The column of a cell: with a header, the heading its text overlaps most
   * (right-aligned numbers start left of their heading but run under it);
   * otherwise, or with no overlap, the column whose start is nearest at or
   * before the cell (else simply the nearest).
   */
  const columnOf = (x0: number, x1: number) => {
    let best = -1;
    let bestOverlap = 0;
    if (hi >= 0) {
      spans.forEach((h, k) => {
        const o = Math.min(x1, h.x1) - Math.max(x0, h.x0);
        if (o > bestOverlap) {
          bestOverlap = o;
          best = k;
        }
      });
      if (best >= 0) return best;
    }
    for (let k = 0; k < spans.length; k++) {
      const right = k + 1 < spans.length ? spans[k + 1].x0 - 6 : Infinity;
      if (x0 >= spans[k].x0 - 6 && x0 < right) return k;
    }
    const mid = (x0 + x1) / 2;
    best = 0;
    spans.forEach((h, k) => {
      if (Math.abs((h.x0 + h.x1) / 2 - mid) < Math.abs((spans[best].x0 + spans[best].x1) / 2 - mid)) best = k;
    });
    return best;
  };
  const rows: string[][] = [];
  lines.forEach((l, idx) => {
    const r: string[] = new Array(spans.length).fill("");
    for (const c of l.cells) {
      const k = columnOf(c.x0, c.x1);
      r[k] = r[k] ? `${r[k]} ${c.text}` : c.text;
    }
    // a wrapped line (nothing in the first column, under a data row): join it to that row
    const prev = rows[rows.length - 1];
    if (idx > hi && hi >= 0 && idx !== hi && !r[0].trim() && prev && prev[0].trim() && !isHead(l.cells) && r.filter((x) => x.trim()).length <= 2) {
      r.forEach((v, k) => {
        if (v.trim()) prev[k] = prev[k] ? `${prev[k]} ${v}` : v;
      });
      return;
    }
    rows.push(r.map(cell));
  });
  return rows;
}

/** The few parts of pdf.js used here (passed in: the browser's bundle, or Node's legacy build in tests). */
export interface PdfJs {
  getDocument(src: Record<string, unknown>): { promise: Promise<PdfDoc>; destroy(): Promise<void> };
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup?(): void }>;
}

/**
 * A PDF's text pieces per page, with pdf.js. Hardened: no eval, no font
 * installation, no scripts or forms (XFA off), at most 300 pages, the
 * deadline checked between pages. A password-protected PDF is refused.
 */
export async function pdfTextItems(pdfjs: PdfJs, bytes: Uint8Array, check: () => void): Promise<PdfItem[][]> {
  const task = pdfjs.getDocument({
    data: bytes.slice(), // pdf.js takes ownership of the buffer
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  let doc: PdfDoc;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy().catch(() => {});
    const name = (e as { name?: string })?.name ?? "";
    if (/Password/i.test(name)) throw new SheetError("encrypted", "The PDF is password-protected.");
    throw new SheetError("corrupt", "The PDF is damaged or can't be read.");
  }
  try {
    if (doc.numPages > 300) throw new SheetError("too_many_rows", "The PDF has too many pages for a product list.");
    const out: PdfItem[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      check();
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      const items: PdfItem[] = [];
      for (const raw of tc.items) {
        const it = raw as { str?: string; transform?: number[]; width?: number; height?: number };
        if (typeof it.str !== "string" || !it.transform) continue;
        const [, , c, d, x, y] = it.transform;
        items.push({ str: it.str, x, y, w: it.width ?? 0, h: it.height || Math.hypot(c, d) || 8 });
      }
      out.push(items);
      page.cleanup?.();
    }
    return out;
  } finally {
    await task.destroy().catch(() => {});
  }
}

/** A serial-number heading ("Sr. No", "S.No", "Serial No", "Item Code", "Part No"). */
export const SERIAL_HEAD = /^(sr|s|serial|sl)\.?\s*(no|number|#)?\.?$|^serial|^item\s*(code|no)|^part\s*(no|number|code)|^code$/i;

// ── one call: bytes -> rows ─────────────────────────────────────────────

export interface ReadResult {
  kind: FileKind;
  rows: string[][];
  /** sheet name for Excel; notes for the preview (never file content) */
  notes: string[];
}

/**
 * Read a product list. `pdfItems` extracts a PDF's text pieces (pdf.js in the
 * browser); it returns null pages for a page without text. Throws SheetError.
 */
export async function readSheet(
  bytes: Uint8Array,
  io: { inflate: Inflate; pdfItems: (bytes: Uint8Array, check: () => void) => Promise<PdfItem[][]> },
  check = deadline(),
): Promise<ReadResult> {
  if (bytes.length > LIMITS.maxBytes) throw new SheetError("too_big", `The file is larger than ${LIMITS.maxBytes / 1024 / 1024} MB.`);
  const s = sniff(bytes);
  if (s === "empty") throw new SheetError("empty", "The file is empty.");
  if (s === "image") throw new SheetError("image", "This is a photo or a scan. It is not supported: use manual entry.");
  if (s === "ole") throw new SheetError("old_office", "Old .doc / .xls files (and password-protected ones) are not supported. Save it as .docx / .xlsx, or use PDF or CSV.");
  if (s === "binary") throw new SheetError("unsupported", "This kind of file is not supported. Use PDF, Word (.docx), Excel (.xlsx) or CSV.");
  const notes: string[] = [];
  if (s === "pdf") {
    const pages = await io.pdfItems(bytes, check);
    const chars = pages.reduce((a, p) => a + p.reduce((b, i) => b + i.str.trim().length, 0), 0);
    if (chars < 20) throw new SheetError("scanned", "This PDF has no readable text (a scan or a photo). It is not supported: use manual entry.");
    const rows = pdfRows(pages, check);
    return { kind: "pdf", rows, notes };
  }
  if (s === "text") {
    const rows = csvRows(decodeText(bytes), check);
    return { kind: "csv", rows, notes };
  }
  // zip: Word or Excel
  const entries = zipDirectory(bytes);
  check();
  const kind = await officeKind(bytes, entries, io.inflate);
  const part = async (name: string) => {
    const e = entries.find((x) => x.name === name);
    return e ? xmlText(await zipRead(bytes, e, io.inflate)) : null;
  };
  if (kind === "docx") {
    const doc = await part("word/document.xml");
    if (doc === null) throw new SheetError("corrupt", "The Word file is damaged.");
    const r = docxTables(doc, check);
    const rows = r.tables.flat().map((row) => row.map(cell));
    if (!rows.length) {
      if (r.pictures > 0 && r.textChars < 40) throw new SheetError("scanned", "This Word file holds pictures (a scan?), not a table. It is not supported: use manual entry.");
      throw new SheetError("no_table", "No table was found in the Word file.");
    }
    if (r.tables.length > 1) notes.push(`${r.tables.length} tables read, one after another.`);
    return { kind, rows, notes };
  }
  const wb = await part("xl/workbook.xml");
  const rels = await part("xl/_rels/workbook.xml.rels");
  if (wb === null || rels === null) throw new SheetError("corrupt", "The Excel file is damaged.");
  const sheets = xlsxSheets(wb, rels, check);
  const sharedXml = await part("xl/sharedStrings.xml");
  const shared = sharedXml ? xlsxSharedStrings(sharedXml, check) : [];
  for (const sh of sheets.filter((x) => !x.hidden)) {
    const xml = await part(sh.path);
    if (!xml) continue;
    const r = xlsxRows(xml, shared, check);
    if (r.rows.some((row) => row.filter((c) => c.trim()).length >= 2)) {
      if (sheets.length > 1) notes.push(`Sheet "${sh.name.slice(0, 40)}" read (the first one with data).`);
      if (r.formulasWithoutValue) notes.push(`${r.formulasWithoutValue} formula cell(s) had no saved value and were read as empty (formulas are never calculated here).`);
      return { kind, rows: r.rows, notes };
    }
  }
  throw new SheetError("no_table", "No data was found in the Excel file.");
}
