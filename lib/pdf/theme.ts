import { Font, StyleSheet } from "@react-pdf/renderer";
import { RUPEE_FONT_DATA_URI, RUPEE_FONT_FAMILY } from "./rupee-font";

// No automatic hyphenation: "Dis-patched", "distribu-tion" read as errors in
// a business document. Long words wrap whole instead.
Font.registerHyphenationCallback((word) => [word]);

// Just the "₹" glyph (Helvetica has none) — see rupee-font.ts and Rupees.tsx.
Font.register({ family: RUPEE_FONT_FAMILY, src: RUPEE_FONT_DATA_URI });

/**
 * Shared look for every exported PDF. Print-first: white page, the logo's
 * navy for structure, hairline grid rules so every value sits in its own
 * clearly bounded cell. Every piece of text is Helvetica-Bold in black (or
 * navy / white on navy) so it prints dark on the office printer, not just on
 * screen. Built-in Helvetica has no ₹ glyph: order money is drawn with
 * <Rupees> (₹ from a bundled Noto Sans subset); the account archive prints
 * bare lib/money amounts under "(INR)" headers.
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
