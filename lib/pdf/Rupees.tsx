import { Text } from "@react-pdf/renderer";
import { formatAmount, type Paise } from "@/lib/money";
import { RUPEE_ADVANCE, RUPEE_FONT_FAMILY } from "./rupee-font";
import { fitWords } from "./fit";

/**
 * An amount for a PDF cell, "₹11,80,000.00" (lib/money formatting), placed
 * inside a <Text>. Only the ₹ is drawn in the bundled Noto Sans subset; the
 * digits keep the document's Helvetica-Bold. With `fit` (the cell's inner
 * width in points and its font size), a number too wide for the cell breaks
 * after a digit-group comma instead of running across the rule.
 */
export function Rupees({
  value,
  fit,
}: {
  value: Paise | null;
  fit?: { width: number; fontSize: number };
}) {
  if (value === null) return <>—</>;
  const digits = formatAmount(value);
  return (
    <>
      <Text style={{ fontFamily: RUPEE_FONT_FAMILY }}>₹</Text>
      {fit ? fitWords(digits, fit.width - (RUPEE_ADVANCE * fit.fontSize) / 1000, fit.fontSize) : digits}
    </>
  );
}
