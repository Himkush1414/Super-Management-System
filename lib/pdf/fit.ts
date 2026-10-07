/**
 * Keeps a word inside its table cell. react-pdf can't break a word that is
 * wider than its column (hyphenation is off, theme.ts), so it draws it
 * across the cell rule. For the dense 16-column tables, a word that cannot
 * fit is split with a hyphen — only then; every other word is untouched.
 * Numbers are never hyphenated: they break after a digit-group comma.
 */

// Helvetica-Bold advance widths (1/1000 em) for ASCII 32..126, from its AFM —
// every PDF prints in bold (theme.ts), so cells are measured in bold.
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 278, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 278, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

function widthOf(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    units += c >= 32 && c <= 126 ? HELVETICA_BOLD[c - 32] : 1000; // dashes, symbols: full em
  }
  return (units * fontSize) / 1000;
}

/** A number too wide for its cell, broken after its digit-group commas. */
function splitNumber(word: string, maxWidth: number, fontSize: number): string {
  // digit groups ("12,", "34,", …); a group still too wide (e.g. "999999")
  // goes one character at a time
  const groups = (word.match(/[^,]+,?/g) ?? [word]).flatMap((g) =>
    widthOf(g, fontSize) > maxWidth ? [...g] : [g],
  );
  const lines: string[] = [];
  let line = "";
  for (const g of groups) {
    if (line && widthOf(line + g, fontSize) > maxWidth) {
      lines.push(line);
      line = g;
    } else line += g;
  }
  return [...lines, line].join("\n");
}

/**
 * `text` with every word wider than `maxWidth` (points) split onto new lines:
 * words are hyphenated, numbers ("12,34,567.89", "1000") break after a comma.
 */
export function fitWords(text: string, maxWidth: number, fontSize: number): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .split(" ")
        .map((word) => {
          if (widthOf(word, fontSize) <= maxWidth) return word;
          if (/^[\d,.]+$/.test(word)) return splitNumber(word, maxWidth, fontSize);
          const parts: string[] = [];
          let part = "";
          for (const ch of word) {
            if (part && widthOf(`${part}${ch}-`, fontSize) > maxWidth) {
              parts.push(`${part}-`);
              part = ch;
            } else part += ch;
          }
          return [...parts, part].join("\n");
        })
        .join(" "),
    )
    .join("\n");
}
