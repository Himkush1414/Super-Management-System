/**
 * lib/inventory/party.ts — Party names and Party search, in the browser.
 *
 * A party is matched by its key: lower-case, inner spaces collapsed,
 * trimmed — exactly public.inv_party_key() in the database, so
 * "  Shree  Traders " and "shree traders" are the same party.
 *
 * No imports: node --test loads it.
 */

export function partyKey(name: string | null | undefined): string {
  return (name ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** One product's receipts from one party (all months), as inv_party_index returns them. */
export interface PartyLine {
  productId: string;
  key: string;
  party: string;
  /** net quantity received from this party (decimal text) */
  qty: string;
  challanNo: string | null;
  billNo: string | null;
  billDate: string | null;
  lastDate: string | null;
}

export function partyLines(ix: { fields: string[]; rows: unknown[][] }): PartyLine[] {
  const at = (n: string) => ix.fields.indexOf(n);
  const i = { p: at("product_id"), k: at("party_key"), n: at("party"), q: at("qty"), c: at("challan_no"), b: at("bill_no"), d: at("bill_date"), l: at("last_date") };
  return ix.rows.map((r) => ({
    productId: r[i.p] as string,
    key: r[i.k] as string,
    party: r[i.n] as string,
    qty: r[i.q] as string,
    challanNo: (r[i.c] as string | null) ?? null,
    billNo: (r[i.b] as string | null) ?? null,
    billDate: (r[i.d] as string | null) ?? null,
    lastDate: (r[i.l] as string | null) ?? null,
  }));
}

/**
 * The lines matching a typed party (key contains the typed key), grouped by
 * product. An empty query matches nothing (no party filter).
 */
export function matchParty(lines: PartyLine[], query: string): Map<string, PartyLine[]> {
  const q = partyKey(query);
  const out = new Map<string, PartyLine[]>();
  if (!q) return out;
  for (const l of lines) {
    if (!l.key.includes(q)) continue;
    const cur = out.get(l.productId);
    if (cur) cur.push(l);
    else out.set(l.productId, [l]);
  }
  return out;
}

/** Up to `max` known party names for a typed text: exact, then starts-with, then contains. */
export function suggestParties(names: string[], typed: string, max = 8): string[] {
  const q = partyKey(typed);
  if (!q) return names.slice(0, max);
  const scored: Array<[number, string]> = [];
  for (const n of names) {
    const k = partyKey(n);
    const at = k.indexOf(q);
    if (at < 0) continue;
    scored.push([k === q ? 0 : at === 0 ? 1 : 2, n]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  return scored.slice(0, max).map((s) => s[1]);
}

/** Known names plus a newly typed one (once per key, the newest spelling wins). */
export function addPartyName(names: string[], name: string): string[] {
  const k = partyKey(name);
  if (!k) return names;
  return [...names.filter((n) => partyKey(n) !== k), name.replace(/\s+/g, " ").trim()].sort((a, b) => a.localeCompare(b));
}
