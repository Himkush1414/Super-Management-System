/**
 * lib/inventory/search.ts — instant product search, entirely in the browser.
 *
 * Case-insensitive, accents folded, extra spaces ignored. Every word of the
 * query must appear somewhere in the product (serial, description,
 * specification or a custom column), in any order: "ferrule 16" finds a
 * "Ferrule … 16 sq.mm" row. Each product's text is normalised once
 * (buildIndex), so a keystroke over 350 products is a few hundred
 * `includes` calls — well under a millisecond.
 *
 * No imports: node --test loads it.
 */

/** Lower-case, accents folded, every run of whitespace -> one space, trimmed. */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The query's words (normalised, empty ones dropped, duplicates removed). */
export function queryTerms(query: string): string[] {
  return [...new Set(normalize(query).split(" ").filter(Boolean))];
}

/** One searchable string per item; fields joined by a separator no query can contain. */
export function buildIndex<T>(items: T[], fields: (item: T) => Array<string | null | undefined>): string[] {
  return items.map((it) => normalize(fields(it).filter(Boolean).join("\u0001")));
}

/** Indexes of the items matching every term (all items for an empty query). */
export function search(index: string[], query: string): number[] {
  const terms = queryTerms(query);
  const out: number[] = [];
  for (let i = 0; i < index.length; i++) {
    const hay = index[i];
    let ok = true;
    for (const t of terms) {
      if (!hay.includes(t)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

export type Segment = { text: string; hit: boolean };

/**
 * Split `text` into plain and highlighted pieces for the query's terms.
 * Matching is case-insensitive on the original text, so what is shown keeps
 * its own capitals and spacing.
 */
export function highlight(text: string, query: string): Segment[] {
  const terms = queryTerms(query);
  if (!text || !terms.length) return [{ text, hit: false }];
  // map each char of the lower-cased, accent-folded text back to the original
  const folded: string[] = [];
  const origin: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = text[i].normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (const ch of f) {
      folded.push(ch);
      origin.push(i);
    }
  }
  const hay = folded.join("");
  const marks = new Array<boolean>(text.length).fill(false);
  for (const t of terms) {
    let from = 0;
    for (;;) {
      const at = hay.indexOf(t, from);
      if (at < 0) break;
      for (let k = at; k < at + t.length; k++) marks[origin[k]] = true;
      from = at + 1;
    }
  }
  const out: Segment[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.hit === marks[i]) last.text += text[i];
    else out.push({ text: text[i], hit: marks[i] });
  }
  return out;
}
