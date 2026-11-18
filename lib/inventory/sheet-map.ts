/**
 * lib/inventory/sheet-map.ts — turns the rows read from a document
 * (sheet-read.ts) into a product list, and compares it with the products in
 * the Inventory: the import preview. Also holds the earlier import script's
 * sheet mapping (scripts/inventory/import-docx.mjs), moved here so both use
 * one set of rules.
 *
 *   columns  Serial, Description, Specification, Rate, Balance — found by
 *            their headings, or inferred from the values when there are none;
 *            the person can change the mapping
 *   numbers  Indian grouping (1,23,456.50), ₹ / Rs, spreadsheet leftovers
 *            like 1E-13 (read as 0); negatives and anything unreadable are
 *            problems, never guesses
 *   matching by serial, compared trimmed, without spaces, any case; by
 *            description only when it is an exact, unique match
 *
 * Pure functions, bigint thousandths / paise. No imports: node --test and the
 * script load this file directly.
 */

// ── text and numbers ────────────────────────────────────────────────────

export const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

/** How serials are compared: trimmed, every space removed, upper case ("ab 12 " = "AB12"). */
export const serialKey = (s: unknown) => clean(s).replace(/\s+/g, "").toUpperCase();

/** How descriptions are compared for the fallback match. */
export const descKey = (s: unknown) => clean(s).toLowerCase();

const T = BigInt(1000);
const ZERO = BigInt(0);

export type NumRead =
  | { kind: "empty" }
  | { kind: "ok"; text: string; value: bigint; artefact?: boolean }
  | { kind: "negative"; text: string }
  | { kind: "bad"; text: string };

/**
 * A number from a document cell, exactly, at `scale` decimals (3 = quantity,
 * 2 = rate). Accepts Indian and western grouping ("1,23,456.50"), spaces,
 * ₹ / Rs / INR, a trailing "/-", and spreadsheet leftovers: a tiny float such
 * as "1E-13" reads as 0, and binary noise beyond the scale ("12.300000000001")
 * is rounded off when it is far below the last kept digit. A negative
 * ("-5", "(5)", "5-") or anything else is reported, never guessed.
 */
export function readNumber(raw: unknown, scale: number): NumRead {
  let t = clean(raw).replace(/^(₹|rs\.?|inr)\s*/i, "").replace(/\s*\/-$/, "").replace(/[\s ]/g, "");
  if (t === "" || t === "-" || t === "—" || t === "–") return { kind: "empty" };
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  if (/^[-−]/.test(t)) {
    neg = true;
    t = t.slice(1);
  } else if (/[-−]$/.test(t)) {
    neg = true;
    t = t.slice(0, -1);
  }
  // grouping commas: 1,234 / 12,34,567 / 1,234,567 (a comma then exactly 2 or 3 digits)
  if (/^\d{1,3}(,\d{2,3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  // scientific notation (spreadsheet output)
  if (/^\d+(\.\d+)?e[-+]?\d+$/i.test(t)) {
    const n = Number(t);
    if (!Number.isFinite(n)) return { kind: "bad", text: clean(raw) };
    if (Math.abs(n) < 0.5 / 10 ** scale) return { kind: "ok", text: "0", value: ZERO, artefact: true };
    if (n >= 1e11) return { kind: "bad", text: clean(raw) };
    t = n.toFixed(scale + 6);
  }
  const parts = /^(\d*)(?:\.(\d*))?$/.exec(t);
  if (!parts || (parts[1] === "" && !parts[2])) return { kind: "bad", text: clean(raw) };
  const int = parts[1] || "0";
  let frac = parts[2] ?? "";
  let artefact = false;
  if (frac.length > scale) {
    const extra = frac.slice(scale);
    // "12.300000000001" or "12.299999999999": floating-point noise, not a real figure
    if (/^0{5,}\d*$/.test(extra) || /^9{5,}\d*$/.test(extra)) {
      artefact = true;
      if (/^9/.test(extra)) {
        const up = BigInt(int + frac.slice(0, scale).padEnd(scale, "0")) + BigInt(1);
        return finish(up, scale, neg, raw, true);
      }
      frac = frac.slice(0, scale);
    } else if (/^0+$/.test(extra)) frac = frac.slice(0, scale);
    else return { kind: "bad", text: clean(raw) };
  }
  return finish(BigInt(int + frac.padEnd(scale, "0")), scale, neg, raw, artefact);
}

function finish(scaled: bigint, scale: number, neg: boolean, raw: unknown, artefact: boolean): NumRead {
  if (neg && scaled !== ZERO) return { kind: "negative", text: clean(raw) };
  const value = scale === 3 ? scaled : scaled * BigInt(10) ** BigInt(3 - scale);
  return { kind: "ok", text: fixed(scaled, scale), value, ...(artefact ? { artefact: true } : {}) };
}

/** scaled integer -> decimal text without trailing zeros ("12.5") */
function fixed(scaled: bigint, scale: number): string {
  const d = BigInt(10) ** BigInt(scale);
  const f = (scaled % d).toString().padStart(scale, "0").replace(/0+$/, "");
  return `${scaled / d}${f ? "." + f : ""}`;
}

/** thousandths -> "12.5" */
export const milliText = (m: bigint) => fixed(m < ZERO ? -m : m, 3);

// ── columns ─────────────────────────────────────────────────────────────

export type Field = "serial" | "description" | "specification" | "rate" | "balance";
export const FIELDS: Field[] = ["serial", "description", "specification", "rate", "balance"];
export const FIELD_LABEL: Record<Field, string> = {
  serial: "Serial No", description: "Description", specification: "Specification", rate: "Rate", balance: "Balance / Qty",
};
export type Mapping = Record<Field, number | null>;

/** Heading patterns (the earlier import script's, plus the new Balance / Qty). */
export const HEAD: Record<Field, RegExp> = {
  serial: /^(sr|s|serial|sl)\.?\s*(no|number|#)?\.?$|^serial|^item\s*(code|no)|^part\s*(no|number|code)|^code$|^product\s*code/i,
  description: /d[ie]sc?r[ie]?p?tion|^material$|^item(\s*name)?$|^particulars?$|^product(\s*name)?$|^name$/i,
  specification: /spec|^size$|^make$/i,
  rate: /^rate|^price|^unit\s*(price|rate|cost)|^cost/i,
  balance: /balance|closing|in\s*stock|^stock$|^qty|^quantity|^physical|^count(ed)?$|^on\s*hand/i,
};

export interface Detected {
  /** row index of the heading row, or -1 when there is none */
  header: number;
  mapping: Mapping;
  /** how each column was found */
  how: Record<Field, "heading" | "inferred" | "none">;
  /** number of columns */
  width: number;
}

const isHeading = (row: string[]) => {
  const hits = FIELDS.filter((f) => row.some((c) => HEAD[f].test(clean(c)))).length;
  return hits >= 2 && row.some((c) => HEAD.serial.test(clean(c)) || HEAD.description.test(clean(c)));
};

/**
 * Find the columns. With a heading row: by heading (the first match wins;
 * "Closing" beats "Opening" for the balance; "Rate" never maps to a quantity).
 * Without: inferred from the values. The person can change any of it.
 */
export function detectColumns(rows: string[][]): Detected {
  const width = Math.min(60, rows.reduce((a, r) => Math.max(a, r.length), 0));
  const header = rows.slice(0, 30).findIndex(isHeading);
  const mapping: Mapping = { serial: null, description: null, specification: null, rate: null, balance: null };
  const how: Detected["how"] = { serial: "none", description: "none", specification: "none", rate: "none", balance: "none" };
  if (header >= 0) {
    const head = rows[header].map(clean);
    for (const f of FIELDS) {
      let idx = head.findIndex((h, i) => h && HEAD[f].test(h) && !Object.values(mapping).includes(i));
      // the balance: the last matching heading ("Opening ... Closing" -> Closing; "Qty ... Balance" -> Balance)
      if (f === "balance") {
        const all = head.map((h, i) => (h && HEAD.balance.test(h) && !/opening/i.test(h) && !Object.values(mapping).includes(i) ? i : -1)).filter((i) => i >= 0);
        idx = all.length ? all[all.length - 1] : -1;
      }
      if (idx >= 0) {
        mapping[f] = idx;
        how[f] = "heading";
      }
    }
    // a "Description" heading but the serial column unnamed: the column before it
    if (mapping.serial === null && mapping.description !== null && mapping.description > 0) {
      mapping.serial = mapping.description - 1;
      how.serial = "inferred";
    }
  }
  const data = rows.slice(header + 1).filter((r) => r.some((c) => clean(c))).slice(0, 200);
  if (data.length) inferMissing(data, width, mapping, how);
  return { header, mapping, how, width };
}

/** Fill the columns nobody named, from what the values look like. */
function inferMissing(data: string[][], width: number, mapping: Mapping, how: Detected["how"]) {
  const taken = () => new Set(Object.values(mapping).filter((v): v is number => v !== null));
  const stats = Array.from({ length: width }, (_, i) => {
    const vals = data.map((r) => clean(r[i])).filter(Boolean);
    const nums = vals.map((v) => readNumber(v, 3));
    const numeric = nums.filter((n) => n.kind === "ok" || n.kind === "negative").length;
    const decimals2 = vals.filter((v) => /\.\d{2}$/.test(v.replace(/,/g, ""))).length;
    const unique = new Set(vals.map(serialKey)).size;
    const avgLen = vals.reduce((a, v) => a + v.length, 0) / Math.max(1, vals.length);
    const codeLike = vals.filter((v) => /\d/.test(v) && v.length <= 40 && !/\s{2,}/.test(v)).length;
    return { i, filled: vals.length, numeric, decimals2, unique, avgLen, codeLike };
  });
  const n = data.length;
  const free = (s: (typeof stats)[number]) => !taken().has(s.i) && s.filled >= n * 0.5;
  if (mapping.serial === null) {
    // short, mostly unique, contains digits, usually the first such column
    const c = stats.filter((s) => free(s) && s.unique >= s.filled * 0.95 && s.codeLike >= s.filled * 0.8 && s.avgLen <= 24
      && !(s.numeric === s.filled && s.decimals2 > s.filled * 0.5));
    if (c.length) {
      mapping.serial = c[0].i;
      how.serial = "inferred";
    }
  }
  if (mapping.description === null) {
    const c = stats.filter((s) => free(s) && s.numeric < s.filled * 0.2).sort((a, b) => b.avgLen - a.avgLen);
    if (c.length) {
      mapping.description = c[0].i;
      how.description = "inferred";
    }
  }
  if (mapping.balance === null) {
    // the right-most mostly-numeric column
    const c = stats.filter((s) => free(s) && s.numeric >= s.filled * 0.8).sort((a, b) => b.i - a.i);
    if (c.length) {
      mapping.balance = c[0].i;
      how.balance = "inferred";
    }
  }
  if (mapping.rate === null) {
    // a numeric column with 2 decimals (money), left of the balance
    const c = stats.filter((s) => free(s) && s.numeric >= s.filled * 0.8 && s.decimals2 >= s.filled * 0.5 && (mapping.balance === null || s.i < mapping.balance));
    if (c.length) {
      mapping.rate = c[0].i;
      how.rate = "inferred";
    }
  }
  if (mapping.specification === null && mapping.description !== null) {
    const c = stats.filter((s) => free(s) && s.numeric < s.filled * 0.5 && s.i > (mapping.description as number));
    if (c.length) {
      mapping.specification = c[0].i;
      how.specification = "inferred";
    }
  }
}

// ── records ─────────────────────────────────────────────────────────────

export interface Record_ {
  /** 1-based line in the data (for the person) */
  line: number;
  serial: string;
  key: string;
  description: string;
  specification: string;
  rate: NumRead;
  balance: NumRead;
}

export interface Records {
  records: Record_[];
  /** heading rows met again (a printed sheet repeats them on every page) */
  repeatedHeadings: number;
  blank: number;
  artefacts: number;
}

/** The data rows under the mapping. Blank and repeated heading rows are skipped. */
export function toRecords(rows: string[][], d: Pick<Detected, "header" | "mapping">, max = 5000): Records {
  const m = d.mapping;
  const out: Record_[] = [];
  let repeatedHeadings = 0;
  let blank = 0;
  let artefacts = 0;
  const at = (r: string[], i: number | null) => (i === null ? "" : clean(r[i]));
  rows.slice(d.header + 1).forEach((r, k) => {
    if (!r.some((c) => clean(c))) {
      blank++;
      return;
    }
    if (isHeading(r)) {
      repeatedHeadings++;
      return;
    }
    // a totals line ("Total", "Grand total") at the end of a sheet
    if (!at(r, m.serial) && /^(grand\s*)?total\b/i.test(at(r, m.description) || clean(r.find((c) => clean(c))))) {
      blank++;
      return;
    }
    const rate = m.rate === null ? ({ kind: "empty" } as NumRead) : readNumber(r[m.rate], 2);
    const balance = m.balance === null ? ({ kind: "empty" } as NumRead) : readNumber(r[m.balance], 3);
    if ((rate.kind === "ok" && rate.artefact) || (balance.kind === "ok" && balance.artefact)) artefacts++;
    out.push({
      line: d.header + 2 + k,
      serial: at(r, m.serial),
      key: serialKey(at(r, m.serial)),
      description: at(r, m.description),
      specification: at(r, m.specification),
      rate,
      balance,
    });
  });
  if (out.length > max) throw Object.assign(new Error(`The file has more than ${max} rows.`), { code: "too_many_rows" });
  return { records: out, repeatedHeadings, blank, artefacts };
}

// ── the preview ─────────────────────────────────────────────────────────

/** A product as the Inventory screen knows it (bigint thousandths / paise). */
export interface KnownProduct {
  id: string;
  serial_no: string;
  description: string;
  specification: string;
  ratePaise: bigint | null;
  balance: bigint;
  pending: boolean;
  is_active: boolean;
}

export interface Matched {
  product: KnownProduct;
  record: Record_;
  file: bigint;
  /** file − current (0 = same) */
  diff: bigint;
  byDescription: boolean;
  /** blanks to fill (only when the product's own value is empty) */
  fill: { specification?: string; ratePaise?: bigint };
}
export interface NewProduct {
  record: Record_;
  balance: bigint;
  ratePaise: bigint | null;
}
export interface Problem {
  line: number;
  serial: string;
  reason: string;
}
export interface Plan {
  matched: Matched[];
  added: NewProduct[];
  /** active products the file doesn't mention */
  notInFile: KnownProduct[];
  problems: Problem[];
  /** how many file rows were read */
  rows: number;
}

const paise = (n: NumRead) => (n.kind === "ok" ? n.value / BigInt(10) : null); // thousandths of a rupee -> paise

/**
 * Compare the file with the Inventory. Nothing here is written anywhere.
 *   - duplicates in the file: every line of that serial is a problem;
 *   - a serial matching an archived product: needs review (restore it first);
 *   - no serial: matched by description only if exactly one product has it;
 *   - a blank, unreadable or negative balance: a problem;
 *   - a new product needs a description (the Inventory requires one).
 */
export function planImport(records: Record_[], products: KnownProduct[]): Plan {
  const byKey = new Map<string, KnownProduct[]>();
  const byDesc = new Map<string, KnownProduct[]>();
  for (const p of products) {
    const k = serialKey(p.serial_no);
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
    if (p.is_active) {
      const dk = descKey(p.description);
      if (dk) byDesc.set(dk, [...(byDesc.get(dk) ?? []), p]);
    }
  }
  const lines = new Map<string, number[]>();
  for (const r of records) if (r.key) lines.set(r.key, [...(lines.get(r.key) ?? []), r.line]);

  const matched: Matched[] = [];
  const added: NewProduct[] = [];
  const problems: Problem[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    const label = r.serial || r.description.slice(0, 40) || "(blank)";
    if (r.key && (lines.get(r.key)?.length ?? 0) > 1) {
      problems.push({ line: r.line, serial: label, reason: `Duplicate serial in the file (lines ${lines.get(r.key)!.join(", ")}).` });
      continue;
    }
    let target: KnownProduct | undefined;
    let byDescription = false;
    if (r.key) {
      const hits = byKey.get(r.key) ?? [];
      if (hits.length > 1) {
        problems.push({ line: r.line, serial: label, reason: "More than one product has this serial once spaces are ignored: needs review." });
        continue;
      }
      target = hits[0];
    } else {
      const hits = r.description ? byDesc.get(descKey(r.description)) ?? [] : [];
      if (hits.length === 1) {
        target = hits[0];
        byDescription = true;
      } else {
        problems.push({ line: r.line, serial: label, reason: hits.length > 1 ? "No serial, and more than one product has this description: needs review." : "No serial number: needs review." });
        continue;
      }
    }
    if (target && seen.has(target.id)) {
      problems.push({ line: r.line, serial: label, reason: `Another line already matched ${target.serial_no}: needs review.` });
      continue;
    }
    if (target && !target.is_active) {
      problems.push({ line: r.line, serial: label, reason: `${target.serial_no} is archived: restore it first, then import again.` });
      continue;
    }
    if (r.balance.kind === "empty") {
      problems.push({ line: r.line, serial: label, reason: "No balance." });
      continue;
    }
    if (r.balance.kind === "negative") {
      problems.push({ line: r.line, serial: label, reason: `Negative balance (${r.balance.text}).` });
      continue;
    }
    if (r.balance.kind === "bad") {
      problems.push({ line: r.line, serial: label, reason: `The balance "${r.balance.text.slice(0, 20)}" is not a number (at most 3 decimals).` });
      continue;
    }
    if (r.balance.value >= BigInt("100000000000000")) {
      problems.push({ line: r.line, serial: label, reason: "The balance is too large." });
      continue;
    }
    const rateBad = r.rate.kind === "bad" || r.rate.kind === "negative";
    if (target) {
      seen.add(target.id);
      const fill: Matched["fill"] = {};
      if (!target.specification.trim() && r.specification) fill.specification = r.specification.slice(0, 300);
      if (target.ratePaise === null && !rateBad && r.rate.kind === "ok") fill.ratePaise = paise(r.rate)!;
      matched.push({ product: target, record: r, file: r.balance.value, diff: r.balance.value - target.balance, byDescription, fill });
    } else {
      if (!r.description) {
        problems.push({ line: r.line, serial: label, reason: "New serial without a description: needs review." });
        continue;
      }
      if (r.serial.length > 40 || r.description.length > 300 || r.specification.length > 300) {
        problems.push({ line: r.line, serial: label, reason: "Too long (serial 40, description and specification 300 characters)." });
        continue;
      }
      if (rateBad) {
        problems.push({ line: r.line, serial: label, reason: `The rate "${"text" in r.rate ? r.rate.text.slice(0, 20) : ""}" is not usable (0 or more, 2 decimals).` });
        continue;
      }
      added.push({ record: r, balance: r.balance.value, ratePaise: paise(r.rate) });
    }
  }
  const matchedIds = new Set(matched.map((m) => m.product.id));
  const mentioned = new Set(records.map((r) => r.key).filter(Boolean));
  const notInFile = products.filter((p) => p.is_active && !matchedIds.has(p.id) && !mentioned.has(serialKey(p.serial_no)));
  return { matched, added, notInFile, problems, rows: records.length };
}

// ── the earlier import script's sheet mapping (moved here, unchanged) ───

/** Heading patterns of scripts/inventory/import-docx.mjs. */
export const RE = {
  serial: /^(sr|s|serial)\.?\s*(no|number)?\.?$|^serial/i,
  description: /d[ie]sc?r[ie]?p?tion|^material$/i,
  specification: /spec/i,
  rate: /^rate/i,
  uom: /^u\.?o\.?m\.?$|^unit/i,
  opening: /opening/i,
  balance: /balance|closing|in\s*stock/i,
  issued: /issue/i,
};

/** Runs of consecutive integers 1, 2, 3… in a header row: the receipt / issue cells. */
export function slotRuns(row: string[]): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let cur: { start: number; end: number } | null = null;
  row.forEach((c, i) => {
    const n = /^\d+$/.test(clean(c)) ? Number(clean(c)) : null;
    if (n === 1) {
      cur = { start: i, end: i };
      runs.push(cur);
    } else if (cur && n === i - cur.start + 1 && i === cur.end + 1) cur.end = i;
    else cur = null;
  });
  return runs.filter((r) => r.end > r.start);
}

const NUM = /^-?\d+(\.\d+)?$/;
const num = (s: unknown) => clean(s).replace(/,/g, "").replace(/^(rs\.?|₹)\s*/i, "");

/**
 * The script's decimal reader: text checked for scale; null = empty, false =
 * invalid. A tiny float like "1E-13" (a spreadsheet's x − x) is read as 0
 * and pushed to `artefacts`.
 */
export function decimal(s: unknown, scale: number, artefacts?: string[]): string | null | false {
  let t = num(s);
  if (t === "" || t === "-") return null;
  if (/^-?\d+(\.\d+)?e-\d+$/i.test(t) && Math.abs(Number(t)) < 0.0005) {
    artefacts?.push(t);
    t = "0";
  }
  if (!NUM.test(t)) return false;
  const frac = t.split(".")[1] ?? "";
  if (frac.replace(/0+$/, "").length > scale) return false;
  return t;
}
export const toMilli = (t: string) => {
  const [i, f = ""] = t.replace("-", "").split(".");
  const v = BigInt(i) * T + BigInt((f + "000").slice(0, 3));
  return t.startsWith("-") ? -v : v;
};
export const fromMilli = (m: bigint) => {
  const neg = m < ZERO;
  const a = neg ? -m : m;
  const f = (a % T).toString().padStart(3, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / T}${f ? "." + f : ""}`;
};
