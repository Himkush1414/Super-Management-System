import { Font, StyleSheet } from "@react-pdf/renderer";

// No automatic hyphenation: "Dis-patched", "distribu-tion" read as errors in
// a business document. Long words wrap whole instead.
Font.registerHyphenationCallback((word) => [word]);

/**
 * Shared look for every exported PDF. Print-first: white page, the logo's
 * navy for structure, hairline grid rules so every value sits in its own
 * clearly bounded cell. Every piece of text is Helvetica-Bold in black (or
 * navy / white on navy) so it prints dark on the office printer, not just on
 * screen. Built-in Helvetica only — it has no ₹ glyph, hence `inr()`.
 */
export const C = {
  ink: "#000000",
  body: "#000000",
  muted: "#000000",
  rule: "#CBD2DC",
  head: "#EEF2F8",
  zebra: "#F8FAFC",
  navy: "#1B2F6B",
  success: "#15803D",
  warning: "#B45309",
};

const inrFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inrPaiseFmt = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "1,25,000" for whole rupees, "1,25,000.50" when there are paise. */
const fmt = (value: number) =>
  Number.isInteger(Math.round(value * 100) / 100) ? inrFmt.format(value) : inrPaiseFmt.format(value);

/** Currency for PDFs: "INR 1,25,000" (Helvetica can't draw "₹"). */
export function inr(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `INR ${fmt(value)}`;
}

/** A bare amount for a column headed "(INR)": "1,25,000" — or "—". */
export function amount(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : fmt(value);
}

export const base = StyleSheet.create({
  page: {
    paddingTop: 30,
    paddingBottom: 50,
    paddingHorizontal: 36,
    fontSize: 9.5,
    color: C.body,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.35,
  },
});
