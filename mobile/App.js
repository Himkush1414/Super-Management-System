// @ts-check
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, BackHandler, Linking, Platform, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import NetInfo from "@react-native-community/netinfo";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView as RNWebView } from "react-native-webview";
import { COLORS, POLICY, START_URL } from "./src/config";
import { decide, deepLink, isRootPage } from "./src/links";
import { buildInjectedScript } from "./src/injected";
import { OfflineScreen } from "./src/OfflineScreen";
import { saveAndShareFile } from "./src/files";

// react-native-webview's class typing defaults its generic to `undefined`, and
// `Props & undefined` is `never` under strict mode; re-type it once here.
/** @typedef {{ reload(): void, goBack(): void, injectJavaScript(js: string): void }} WebViewHandle */
const WebView = /** @type {import('react').ComponentType<import('react-native-webview').WebViewProps & { ref?: import('react').Ref<WebViewHandle> }>} */ (
  /** @type {unknown} */ (RNWebView)
);

void SplashScreen.preventAutoHideAsync().catch(() => {});

const INJECTED = buildInjectedScript();
/** Below this the socket is almost certainly still alive; don't touch it. */
const RESUME_NUDGE_MS = 5000;

// Connectivity comes from the OS only. NetInfo's own reachability check
// pings a Google URL on a timer; that is polling, and blocked by some
// networks (false "offline"), so it is switched off. Real failures are
// caught by the WebView's own load errors.
NetInfo.configure({ reachabilityShouldRun: () => false, useNativeReachability: false });

/** @param {import('@react-native-community/netinfo').NetInfoState} s */
const isOnline = (s) => s.isConnected !== false;

/**
 * App deep links: nrmanagement:///dashboard/orders/<id> opens that page.
 * @param {string | null | undefined} url
 */
function pathFromAppLink(url) {
  if (!url) return null;
  const m = /^nrmanagement:\/\/[^/]*(\/[^?#]*)?/.exec(url);
  return m && m[1] ? m[1] : null;
}

export default function App() {
  const webRef = useRef(/** @type {WebViewHandle | null} */ (null));
  const canGoBack = useRef(false);
  const currentUrl = useRef(START_URL);
  const backgroundedAt = useRef(/** @type {number | null} */ (null));

  const [startUrl] = useState(START_URL);
  const [theme, setTheme] = useState(/** @type {"dark" | "light"} */ ("dark"));
  const [offline, setOffline] = useState(false);
  const [checking, setChecking] = useState(false);
  const [stillOffline, setStillOffline] = useState(false);
  const [errorDetail, setErrorDetail] = useState(/** @type {string | undefined} */ (undefined));
  // read by the AppState/NetInfo/BackHandler listeners, which are set up once
  const offlineRef = useRef(false);
  useEffect(() => {
    offlineRef.current = offline;
  }, [offline]);

  const colors = COLORS[theme];

  const hideSplash = useCallback(() => {
    void SplashScreen.hideAsync().catch(() => {});
  }, []);

  // never leave the splash up if the network is slow
  useEffect(() => {
    const t = setTimeout(hideSplash, 8000);
    return () => clearTimeout(t);
  }, [hideSplash]);

  /** Open a website URL inside the running WebView. */
  const navigate = useCallback((/** @type {string} */ url) => {
    webRef.current?.injectJavaScript(`location.assign(${JSON.stringify(url)});true;`);
  }, []);

  // true when the current page failed to load (vs. the network dropping
  // under a page that is still there, with whatever the user typed)
  const loadFailed = useRef(false);

  const retry = useCallback(async () => {
    setChecking(true);
    const s = await NetInfo.fetch().catch(() => null);
    setChecking(false);
    if (s && !isOnline(s)) {
      setStillOffline(true);
      return;
    }
    setStillOffline(false);
    setErrorDetail(undefined);
    setOffline(false);
    if (loadFailed.current) webRef.current?.reload();
    else webRef.current?.injectJavaScript("window.__nrResume&&window.__nrResume(0);true;");
  }, []);

  // connection lost: the offline screen covers the page (which stays
  // underneath, untouched). Connection back: the screen goes away by
  // itself and realtime reconnects at once; a page that had failed to
  // load is loaded again.
  useEffect(() => {
    let wasOnline = true;
    return NetInfo.addEventListener((s) => {
      const online = isOnline(s);
      if (!online) setOffline(true);
      else if (!wasOnline && offlineRef.current) void retry();
      wasOnline = online;
    });
  }, [retry]);

  // back to the foreground: retry if offline, else nudge realtime and let
  // read-only pages refresh (see src/injected.js)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        backgroundedAt.current = Date.now();
        return;
      }
      if (state !== "active" || backgroundedAt.current === null) return;
      const away = Date.now() - backgroundedAt.current;
      backgroundedAt.current = null;
      if (offlineRef.current) void retry();
      else if (away >= RESUME_NUDGE_MS) {
        webRef.current?.injectJavaScript(`window.__nrResume&&window.__nrResume(${away});true;`);
      }
    });
    return () => sub.remove();
  }, [retry]);

  // Android hardware back / back gesture: page history first, then leave
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (offlineRef.current) return false;
      if (canGoBack.current && !isRootPage(currentUrl.current)) {
        webRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  // nrmanagement:// links (cold start and while running)
  useEffect(() => {
    const open = (/** @type {string | null | undefined} */ url) => {
      const path = pathFromAppLink(url);
      if (path) navigate(deepLink(path, POLICY));
    };
    void Linking.getInitialURL().then(open).catch(() => {});
    const sub = Linking.addEventListener("url", (e) => open(e.url));
    return () => sub.remove();
  }, [navigate]);

  /** @type {(req: import('react-native-webview/lib/WebViewTypes').ShouldStartLoadRequest) => boolean} */
  const onShouldStart = useCallback((req) => {
    const d = decide(req.url, POLICY);
    if (d === "external") void Linking.openURL(req.url).catch(() => {});
    return d === "load";
  }, []);

  const onMessage = useCallback((/** @type {import('react-native-webview').WebViewMessageEvent} */ e) => {
    /** @type {any} */
    let msg;
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    switch (msg?.type) {
      case "theme":
        setTheme(msg.value === "light" ? "light" : "dark");
        break;
      case "blob-download-blocked":
        Alert.alert(
          "Not available in the app",
          "This file can only be downloaded on the website in a computer browser. Nothing was deleted.",
        );
        break;
      case "file":
        void saveAndShareFile(msg).catch(() =>
          Alert.alert("Download failed", "The file could not be saved. Please try again."),
        );
        break;
      case "file-error":
        Alert.alert("Download failed", "The file could not be downloaded. Please try again.");
        break;
      default:
        break;
    }
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={["top", "bottom", "left", "right"]}>
        <StatusBar style={theme === "light" ? "dark" : "light"} />
        <View style={styles.root}>
          <WebView
            ref={webRef}
            source={{ uri: startUrl }}
            originWhitelist={["https://*"]}
            onShouldStartLoadWithRequest={onShouldStart}
            injectedJavaScriptBeforeContentLoaded={INJECTED}
            injectedJavaScriptBeforeContentLoadedForMainFrameOnly
            onMessage={onMessage}
            onNavigationStateChange={(nav) => {
              canGoBack.current = nav.canGoBack;
              currentUrl.current = nav.url;
            }}
            onLoadEnd={() => {
              hideSplash();
            }}
            onLoad={() => {
              loadFailed.current = false;
            }}
            onError={(e) => {
              // the page itself failed to load (no network, DNS, TLS…)
              loadFailed.current = true;
              setErrorDetail(e.nativeEvent.description);
              setOffline(true);
              hideSplash();
            }}
            // the offline screen covers failures; never flash the default red error text
            renderError={() => <View style={[styles.root, { backgroundColor: colors.bg }]} />}
            onRenderProcessGone={() => webRef.current?.reload()}
            onContentProcessDidTerminate={() => webRef.current?.reload()}
            onFileDownload={({ nativeEvent }) => {
              // iOS only: fetch it inside the page so the session cookie goes along
              if (decide(nativeEvent.downloadUrl, POLICY) !== "load") return;
              webRef.current?.injectJavaScript(
                `window.__nrFetchFile&&window.__nrFetchFile(${JSON.stringify(nativeEvent.downloadUrl)});true;`,
              );
            }}
            downloadingMessage="Downloading…"
            lackPermissionToDownloadMessage="Allow storage access to download files."
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled={false}
            cacheEnabled
            mixedContentMode="never"
            allowFileAccess={false}
            setSupportMultipleWindows={false}
            allowsBackForwardNavigationGestures
            allowsLinkPreview={false}
            pullToRefreshEnabled={false}
            textZoom={100}
            webviewDebuggingEnabled={__DEV__}
            applicationNameForUserAgent={`NRManagement/1.0 (${Platform.OS})`}
            style={{ backgroundColor: colors.bg }}
          />
          {offline ? (
            <OfflineScreen
              colors={colors}
              checking={checking}
              stillOffline={stillOffline}
              detail={errorDetail}
              onRetry={retry}
            />
          ) : null}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
