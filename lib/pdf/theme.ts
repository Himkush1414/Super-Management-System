import { StyleSheet } from "@react-pdf/renderer";

/**
 * Shared look for every exported PDF. Print-first: white page, near-black
 * text, one restrained accent (the same blue as the app), hairline rules.
 * Built-in Helvetica only — it has no ₹ glyph, hence `inr()` below.
 */
export const C = {
  ink: "#0A0A0A",
  body: "#1F2937",
  muted: "#6B7280",
  faint: "#9CA3AF",
  rule: "#E5E7EB",
  tint: "#F6F7F9",
  accent: "#2563EB",
  success: "#15803D",
  warning: "#B45309",
};

const inrFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Currency for PDFs: "INR 1,25,000" (Helvetica can't draw "₹"). */
export function inr(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `INR ${inrFmt.format(value)}`;
}

export const base = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 54,
    paddingHorizontal: 40,
    fontSize: 9.5,
    color: C.body,
    fontFamily: "Helvetica",
    lineHeight: 1.35,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: 12,
    marginBottom: 18,
    borderBottom: `1 solid ${C.ink}`,
  },
  brandRow: { flexDirection: "row", alignItems: "center" },
  mark: {
    width: 18,
    height: 18,
    borderRadius: 4,
    backgroundColor: C.ink,
    color: "#FFFFFF",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    textAlign: "center",
    paddingTop: 5,
    marginRight: 7,
  },
  brand: { fontSize: 12.5, fontFamily: "Helvetica-Bold", color: C.ink },
  docType: {
    fontSize: 7.5,
    color: C.muted,
    marginTop: 3,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  meta: { fontSize: 7.5, color: C.muted, textAlign: "right" },
  sectionTitle: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: C.muted,
    marginBottom: 7,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: C.faint,
    borderTop: `0.5 solid ${C.rule}`,
    paddingTop: 7,
  },
});
