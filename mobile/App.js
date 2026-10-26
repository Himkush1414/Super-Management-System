// @ts-check
import { useCallback, useRef } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView as RNWebView } from "react-native-webview";
import { COLORS, POLICY, START_URL } from "./src/config";
import { decide } from "./src/links";

// react-native-webview's class typing defaults its generic to `undefined`, and
// `Props & undefined` is `never` under strict mode; re-type it once here.
/** @typedef {{ reload(): void, goBack(): void, injectJavaScript(js: string): void }} WebViewHandle */
const WebView = /** @type {import('react').ComponentType<import('react-native-webview').WebViewProps & { ref?: import('react').Ref<WebViewHandle> }>} */ (
  /** @type {unknown} */ (RNWebView)
);

export default function App() {
  const webRef = useRef(/** @type {WebViewHandle | null} */ (null));

  /** @type {(req: import('react-native-webview/lib/WebViewTypes').ShouldStartLoadRequest) => boolean} */
  const onShouldStart = useCallback((req) => {
    const d = decide(req.url, POLICY);
    if (d === "external") void Linking.openURL(req.url).catch(() => {});
    return d === "load";
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.root, { backgroundColor: COLORS.dark.bg }]} edges={["top", "bottom", "left", "right"]}>
        <StatusBar style="light" />
        <View style={styles.root}>
          <WebView
            ref={webRef}
            source={{ uri: START_URL }}
            originWhitelist={["https://*"]}
            onShouldStartLoadWithRequest={onShouldStart}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled={false}
            cacheEnabled
            mixedContentMode="never"
            allowFileAccess={false}
            setSupportMultipleWindows={false}
            webviewDebuggingEnabled={__DEV__}
            style={{ backgroundColor: COLORS.dark.bg }}
          />
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
