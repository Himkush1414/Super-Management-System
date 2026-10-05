import { Text, View } from "@react-pdf/renderer";
import { base } from "./theme";

/** Letterhead used at the top of every exported PDF. */
export function PdfHeader({
  docType,
  metaLines,
}: {
  docType: string;
  metaLines: string[];
}) {
  return (
    <View style={base.header} fixed>
      <View>
        <View style={base.brandRow}>
          <Text style={base.mark}>NR</Text>
          <Text style={base.brand}>NR Industries</Text>
        </View>
        <Text style={base.docType}>{docType}</Text>
      </View>
      <View>
        {metaLines.map((l) => (
          <Text key={l} style={base.meta}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

export function PdfFooter() {
  return (
    <View style={base.footer} fixed>
      <Text>NR Industries — internal document. Not for external distribution.</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}
