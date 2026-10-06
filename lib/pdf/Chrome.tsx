import { Image, Text, View, StyleSheet } from "@react-pdf/renderer";
import { LOGO_ASPECT, LOGO_DATA_URI } from "./logo";
import { C } from "./theme";
import { formatStamp } from "@/lib/utils";

const LOGO_H = 40;

/** Printed on every PDF letterhead and signature block. */
export const COMPANY = {
  name: "NR Industries",
  address: [
    "Vill. Rampur Banjaran, PO Dhaulakuan, Tehsil Paonta Sahib,",
    "Distt. Sirmaur, Himachal Pradesh 173031, INDIA",
  ],
};

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: 10,
    marginBottom: 16,
    borderBottom: `1.5 solid ${C.navy}`,
  },
  logo: { height: LOGO_H, width: LOGO_H * LOGO_ASPECT },
  address: { marginTop: 5, fontSize: 7.5, lineHeight: 1.4, color: C.body },
  titleBlock: { alignItems: "flex-end" },
  docType: { fontSize: 13, fontFamily: "Helvetica-Bold", color: C.navy },
  docSub: { fontSize: 8.5, color: C.muted, marginTop: 3 },
  stamp: { fontSize: 8, color: C.body, marginTop: 5 },
  stampLabel: { color: C.muted },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 36,
    right: 36,
    borderTop: `0.75 solid ${C.rule}`,
    paddingTop: 6,
    fontSize: 8,
    color: C.muted,
  },
  sign: { alignSelf: "flex-end", width: 190, marginTop: 36, alignItems: "center" },
  signSpace: { height: 42 },
  signLine: { width: "100%", borderTop: `0.75 solid ${C.ink}` },
  signRole: { marginTop: 4, fontSize: 9, color: C.body },
  signCompany: { marginTop: 2, fontSize: 9.5, fontFamily: "Helvetica-Bold", color: C.navy },
});

/**
 * Letterhead, repeated at the top of every page: logo and company address on
 * the left; document title, subtitle and generation time on the right.
 */
export function PdfHeader({
  title,
  subtitle,
  generatedAt,
}: {
  title: string;
  subtitle?: string;
  generatedAt: Date;
}) {
  return (
    <View style={s.header} fixed>
      <View>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not an <img> */}
        <Image src={LOGO_DATA_URI} style={s.logo} />
        <Text style={s.address}>{COMPANY.address.join("\n")}</Text>
      </View>
      <View style={s.titleBlock}>
        <Text style={s.docType}>{title}</Text>
        {subtitle ? <Text style={s.docSub}>{subtitle}</Text> : null}
        <Text style={s.stamp}>
          <Text style={s.stampLabel}>Generated: </Text>
          {formatStamp(generatedAt)}
        </Text>
      </View>
    </View>
  );
}

/**
 * Footer, every page: the company name only — no names, no attribution. (No
 * page numbers: react-pdf won't draw `render` text under the page lineHeight.)
 */
export function PdfFooter() {
  return (
    <Text style={s.footer} fixed>
      {COMPANY.name}
    </Text>
  );
}

/**
 * Signature block, once, after the content: space to sign, a rule, the
 * signatory's role in brackets and the company. Never split across pages.
 */
export function PdfSignature({ role = "Head" }: { role?: string }) {
  return (
    <View style={s.sign} wrap={false}>
      <View style={s.signSpace} />
      <View style={s.signLine} />
      <Text style={s.signRole}>({role})</Text>
      <Text style={s.signCompany}>{COMPANY.name}</Text>
    </View>
  );
}
