import { Font, StyleSheet } from "@react-pdf/renderer";

// No automatic hyphenation: "Dis-patched", "distribu-tion" read as errors in
// a business document. Long words wrap whole instead.
Font.registerHyphenationCallback((word) => [word]);

/**
 * Shared look for every exported PDF. Print-first: white page, the logo's
 * navy for structure, hairline grid rules so every value sits in its own
 * clearly bounded cell. Built-in Helvetica only — it has no ₹ glyph, hence
 * `inr()`.
 */
export const C = {
  ink: "#0B1220",
  body: "#1F2937",
  muted: "#6B7280",
  rule: "#CBD2DC",
  head: "#EEF2F8",
  zebra: "#F8FAFC",
  navy: "#1B2F6B",
  success: "#15803D",
  warning: "#B45309",
};

const inrFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** Currency for PDFs: "INR 1,25,000" (Helvetica can't draw "₹"). */
export function inr(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `INR ${inrFmt.format(value)}`;
}

export const base = StyleSheet.create({
  page: {
    paddingTop: 30,
    paddingBottom: 50,
    paddingHorizontal: 36,
    fontSize: 9.5,
    color: C.body,
    fontFamily: "Helvetica",
    lineHeight: 1.35,
  },
});
