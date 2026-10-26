// @ts-check
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

/**
 * Shown instead of the website whenever it can't be reached. The app is
 * online-only: nothing here is cached or editable.
 *
 * @param {{
 *   colors: { bg: string, panel: string, text: string, muted: string, accent: string },
 *   checking: boolean,
 *   stillOffline: boolean,
 *   detail?: string,
 *   onRetry: () => void,
 * }} props
 */
export function OfflineScreen({ colors, checking, stillOffline, detail, onRetry }) {
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]} accessibilityRole="alert">
      <Svg width={72} height={72} viewBox="0 0 32 32" fill="none">
        <Rect x={1} y={1} width={30} height={30} rx={7} stroke={colors.text} strokeOpacity={0.35} strokeWidth={1.5} />
        <Path d="M9 23V9l7 9 7-9v14" stroke={colors.text} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={16} cy={24.5} r={1.6} fill={colors.accent} />
      </Svg>
      <Text style={[styles.title, { color: colors.text }]}>You&apos;re offline</Text>
      <Text style={[styles.body, { color: colors.muted }]}>
        NR Management needs an internet connection. Check your Wi-Fi or mobile data, then try again.
      </Text>
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
});
