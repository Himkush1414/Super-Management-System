// @ts-check
import { useRef } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

/**
 * Why the website isn't showing:
 * - "offline": no connection (or the page couldn't be reached at all)
 * - "server": the website answered with a server error
 * - "slow": a page load took too long and was stopped
 * @typedef {"offline" | "server" | "slow"} ErrorKind
 */

/** @type {Record<ErrorKind, { title: string, body: string }>} */
const TEXT = {
  offline: {
    title: "You’re offline",
    body: "NR Management needs an internet connection. Check your Wi-Fi or mobile data, then try again.",
  },
  server: {
    title: "Something went wrong",
    body: "The website had a problem answering. This is usually over in a moment; the app tries again by itself.",
  },
  slow: {
    title: "This is taking too long",
    body: "The page didn’t finish loading. Your connection may be slow. Try again.",
  },
};

/** Taps on the version, each within this of the last, that open Diagnostics. */
const SECRET_TAPS = 5;
const SECRET_GAP_MS = 1500;

/**
 * Shown instead of the website whenever it can't be shown. The app is
 * online-only: nothing here is cached or editable. Tapping the version at
 * the bottom five times opens the hidden Diagnostics screen.
 *
 * @param {{
 *   kind?: ErrorKind,
 *   colors: { bg: string, panel: string, text: string, muted: string, accent: string },
 *   checking: boolean,
 *   stillOffline: boolean,
 *   detail?: string,
 *   version: string,
 *   onRetry: () => void,
 *   onDiagnostics: () => void,
 * }} props
 */
export function OfflineScreen({ kind = "offline", colors, checking, stillOffline, detail, version, onRetry, onDiagnostics }) {
  const text = TEXT[kind] ?? TEXT.offline;
  const taps = useRef({ n: 0, at: 0 });
  const onVersionTap = () => {
    const t = Date.now();
    taps.current = { n: t - taps.current.at < SECRET_GAP_MS ? taps.current.n + 1 : 1, at: t };
    if (taps.current.n >= SECRET_TAPS) {
      taps.current = { n: 0, at: 0 };
      onDiagnostics();
    }
  };
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]} accessibilityRole="alert">
      <Svg width={72} height={72} viewBox="0 0 32 32" fill="none">
        <Rect x={1} y={1} width={30} height={30} rx={7} stroke={colors.text} strokeOpacity={0.35} strokeWidth={1.5} />
        <Path d="M9 23V9l7 9 7-9v14" stroke={colors.text} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={16} cy={24.5} r={1.6} fill={colors.accent} />
      </Svg>
      <Text style={[styles.title, { color: colors.text }]}>{text.title}</Text>
      <Text style={[styles.body, { color: colors.muted }]}>{text.body}</Text>
      {stillOffline && !checking ? (
        <Text style={[styles.hint, { color: colors.muted }]}>Still no connection.</Text>
      ) : null}
      {detail ? <Text style={[styles.detail, { color: colors.muted }]}>{detail}</Text> : null}
      <Pressable
        onPress={onRetry}
        disabled={checking}
        accessibilityRole="button"
        accessibilityLabel="Retry"
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: colors.accent, opacity: pressed || checking ? 0.75 : 1 },
        ]}
      >
        {checking ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>Retry</Text>}
      </Pressable>
      <Pressable onPress={onVersionTap} style={styles.version} hitSlop={16} accessibilityLabel={`Version ${version}`}>
        <Text style={[styles.versionText, { color: colors.muted }]}>{version}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", padding: 32 },
  title: { marginTop: 24, fontSize: 20, fontWeight: "600" },
  body: { marginTop: 8, fontSize: 15, lineHeight: 22, textAlign: "center", maxWidth: 320 },
  hint: { marginTop: 12, fontSize: 13 },
  detail: { marginTop: 4, fontSize: 11, opacity: 0.7, textAlign: "center" },
  button: { marginTop: 28, minWidth: 140, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  version: { position: "absolute", bottom: 28, paddingHorizontal: 16, paddingVertical: 8 },
  versionText: { fontSize: 12, opacity: 0.6 },
});
