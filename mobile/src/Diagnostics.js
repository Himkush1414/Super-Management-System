// @ts-check
import { Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { clock, formatReport } from "./loading";

/**
 * Hidden screen for reading real timings on a phone: the last navigations
 * with their duration and result, the WebView settings and the app
 * version. Opened by tapping the version five times on the offline / error
 * screen. Shows timings and page paths only, never page content or data.
 *
 * @param {{
 *   visible: boolean,
 *   log: import('./loading').LogEntry[],
 *   about: [string, string][],
 *   colors: { bg: string, panel: string, text: string, muted: string, accent: string },
 *   onClear: () => void,
 *   onClose: () => void,
 * }} props
 */
export function Diagnostics({ visible, log, about, colors, onClear, onClose }) {
  const share = () => {
    void Share.share({ message: formatReport(log, about) }).catch(() => {});
  };
  const resultColor = (/** @type {string} */ r) => (r === "ok" || r === "online" ? colors.muted : colors.accent);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent={false}>
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Diagnostics</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12}>
            <Text style={[styles.link, { color: colors.accent }]}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={[styles.section, { color: colors.muted }]}>APP AND WEBVIEW</Text>
          {about.map(([k, v]) => (
            <View key={k} style={styles.row}>
              <Text style={[styles.key, { color: colors.muted }]}>{k}</Text>
              <Text style={[styles.value, { color: colors.text }]} selectable>
                {v}
              </Text>
            </View>
          ))}
          <Text style={[styles.section, { color: colors.muted }]}>
            LAST {log.length} NAVIGATIONS (NEWEST FIRST)
          </Text>
          {log.length === 0 ? <Text style={[styles.value, { color: colors.muted }]}>Nothing recorded yet.</Text> : null}
          {log.map((e, i) => (
            <View key={`${e.at}-${i}`} style={[styles.entry, { borderColor: colors.panel }]}>
              <View style={styles.entryTop}>
                <Text style={[styles.mono, { color: colors.muted }]}>{clock(e.at).slice(5)}</Text>
                <Text style={[styles.mono, { color: colors.text }]}>{e.ms === null ? "-" : `${e.ms} ms`}</Text>
                <Text style={[styles.mono, { color: resultColor(e.result) }]}>{e.result}</Text>
              </View>
              <Text style={[styles.mono, { color: colors.text }]} numberOfLines={1}>
                {e.kind} {e.path}
              </Text>
              {e.note ? <Text style={[styles.note, { color: colors.muted }]}>{e.note}</Text> : null}
            </View>
          ))}
        </ScrollView>
        <View style={styles.footer}>
          <Pressable
            onPress={share}
            accessibilityRole="button"
            style={[styles.button, { backgroundColor: colors.accent }]}
          >
            <Text style={styles.buttonText}>Share</Text>
          </Pressable>
          <Pressable
            onPress={onClear}
            accessibilityRole="button"
            style={[styles.button, { backgroundColor: colors.panel }]}
          >
            <Text style={[styles.buttonText, { color: colors.text }]}>Clear list</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 20, fontWeight: "600" },
  link: { fontSize: 16, fontWeight: "600" },
  body: { paddingHorizontal: 20, paddingBottom: 24 },
  section: { marginTop: 18, marginBottom: 8, fontSize: 11, fontWeight: "600", letterSpacing: 0.6 },
  row: { flexDirection: "row", paddingVertical: 3, gap: 10 },
  key: { width: 130, fontSize: 13 },
  value: { flex: 1, fontSize: 13 },
  entry: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 7 },
  entryTop: { flexDirection: "row", justifyContent: "space-between" },
  mono: { fontFamily: "monospace", fontSize: 12 },
  note: { fontSize: 11, marginTop: 2 },
  footer: { flexDirection: "row", gap: 12, padding: 16 },
  button: { flex: 1, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
});
