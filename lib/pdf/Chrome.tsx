import { Image, Text, View, StyleSheet } from "@react-pdf/renderer";
import { LOGO_ASPECT, LOGO_DATA_URI } from "./logo";
import { C } from "./theme";
import { formatStamp } from "@/lib/utils";

const LOGO_H = 40;

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
  titleBlock: { alignItems: "flex-end" },
  docType: { fontSize: 13, fontFamily: "Helvetica-Bold", color: C.navy },
  docSub: { fontSize: 8.5, color: C.muted, marginTop: 3 },
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
});

/** Logo letterhead, repeated at the top of every page. */
export function PdfHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={s.header} fixed>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not an <img> */}
      <Image src={LOGO_DATA_URI} style={s.logo} />
      <View style={s.titleBlock}>
        <Text style={s.docType}>{title}</Text>
        {subtitle ? <Text style={s.docSub}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

/** Footer, every page: the generation time only — no names, no attribution. */
export function PdfFooter({ generatedAt }: { generatedAt: Date }) {
  return (
    <Text style={s.footer} fixed>
      Generated: {formatStamp(generatedAt)}
    </Text>
  );
}
