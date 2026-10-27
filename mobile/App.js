// @ts-check
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, BackHandler, Keyboard, Linking, Platform, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { NavigationBar } from "expo-navigation-bar";
import NetInfo from "@react-native-community/netinfo";
import * as Notifications from "expo-notifications";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView as RNWebView } from "react-native-webview";
import { POLICY, START_URL, WEB_URL } from "./src/config";
import { DEFAULT_BG, cssColorToHex, shellColors } from "./src/colors";
import { loadCachedBg, saveCachedBg } from "./src/shellCache";
import { ProgressBar } from "./src/ProgressBar";
import { decide, deepLink, isRootPage } from "./src/links";
import { buildInjectedScript } from "./src/injected";
import { OfflineScreen } from "./src/OfflineScreen";
import { saveAndShareFile } from "./src/files";
import { createPushRegistrar, ensureChannel } from "./src/push";

// react-native-webview's class typing defaults its generic to `undefined`, and
// `Props & undefined` is `never` under strict mode; re-type it once here.
/** @typedef {{ reload(): void, goBack(): void, stopLoading(): void, injectJavaScript(js: string): void }} WebViewHandle */
const WebView = /** @type {import('react').ComponentType<import('react-native-webview').WebViewProps & { ref?: import('react').Ref<WebViewHandle> }>} */ (
  /** @type {unknown} */ (RNWebView)
);

void SplashScreen.preventAutoHideAsync().catch(() => {});
// the splash stays until the first page has painted, then fades out
try {
  SplashScreen.setOptions({ duration: 250, fade: true });
} catch {
  // older native module: it just disappears without the fade
}

const INJECTED = buildInjectedScript();
/** Below this the socket is almost certainly still alive; don't touch it. */
const RESUME_NUDGE_MS = 5000;
/** The splash never stays longer than this, even on a very slow network. */
const SPLASH_MAX_MS = 10000;
/** A page switch inside the website that never reports back stops the bar. */
const NAV_MAX_MS = 15000;
/** A full page load still going after this shows the error screen with Retry. */
const SLOW_LOAD_MS = 20000;
/** Server errors retry by themselves after these waits, then wait for Retry. */
const SERVER_RETRY_MS = [10000, 20000, 40000];
/** The page answers the back button within this, or the app decides alone. */
const BACK_REPLY_MS = 350;

// Connectivity comes from the OS only. NetInfo's own reachability check
// pings a Google URL on a timer; that is polling, and blocked by some
// networks (false "offline"), so it is switched off. Real failures are
// caught by the WebView's own load errors.
NetInfo.configure({ reachabilityShouldRun: () => false, useNativeReachability: false });

/** @param {import('@react-native-community/netinfo').NetInfoState} s */
const isOnline = (s) => s.isConnected !== false;

/**
 * The website page a notification should open, or null.
 * @param {Notifications.NotificationResponse | null | undefined} response
 */
function urlFromNotification(response) {
  const data = response?.notification.request.content.data;
  return data && typeof data.url === "string" ? deepLink(data.url, POLICY) : null;
}

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
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const insets = useSafeAreaInsets();
  const webRef = useRef(/** @type {WebViewHandle | null} */ (null));
  const canGoBack = useRef(false);
  const currentUrl = useRef(START_URL);
  const backgroundedAt = useRef(/** @type {number | null} */ (null));

  // cold start from a notification tap: open that order directly
  const [startUrl] = useState(() => urlFromNotification(Notifications.getLastNotificationResponse()) ?? START_URL);
  const registrar = useRef(/** @type {ReturnType<typeof createPushRegistrar> | null} */ (null));
  if (registrar.current === null) registrar.current = createPushRegistrar();
  // the page's own background colour: cached from the last run, so the
  // first frame already matches (no white flash, no wrong-coloured bars)
  const [bg, setBg] = useState(() => loadCachedBg() ?? DEFAULT_BG);
  const [pageLoading, setPageLoading] = useState(false);
  const [navLoading, setNavLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [checking, setChecking] = useState(false);
  const [stillOffline, setStillOffline] = useState(false);
  const [errorDetail, setErrorDetail] = useState(/** @type {string | undefined} */ (undefined));
  // what the error screen says: no connection, the server failed, or too slow
  const [errorKind, setErrorKind] = useState(/** @type {import('./src/OfflineScreen').ErrorKind} */ ("offline"));
  // Android: the keyboard's height, and how much height the window gave up for it
  const [keyboard, setKeyboard] = useState(0);
  const [rootHeight, setRootHeight] = useState(0);
  const [openHeight, setOpenHeight] = useState(0);
  // bumping this loads a tiny page in a hidden WebView, which makes Android
  // write the session cookie to disk at once (see the CookieFlush below)
  const [cookieFlush, setCookieFlush] = useState(0);
  const lastUser = useRef(/** @type {string | null | undefined} */ (undefined));
  // read by the AppState/NetInfo/BackHandler listeners, which are set up once
  const offlineRef = useRef(false);
  useEffect(() => {
    offlineRef.current = offline;
  }, [offline]);

  const colors = useMemo(() => shellColors(bg), [bg]);

  const hideSplash = useCallback(() => {
    void SplashScreen.hideAsync().catch(() => {});
  }, []);

  // never leave the splash up if the network is slow
  useEffect(() => {
    const t = setTimeout(hideSplash, SPLASH_MAX_MS);
    return () => clearTimeout(t);
  }, [hideSplash]);

  // the root view (behind everything, seen during rotation or the keyboard
  // animating) takes the page colour too; remembered for the next start
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(bg).catch(() => {});
    saveCachedBg(bg);
  }, [bg]);

  // a page switch inside the website that never reports back
  useEffect(() => {
    if (!navLoading) return;
    const t = setTimeout(() => setNavLoading(false), NAV_MAX_MS);
    return () => clearTimeout(t);
  }, [navLoading]);

  /** Cover the page with the error screen. */
  const showError = useCallback((
    /** @type {import('./src/OfflineScreen').ErrorKind} */ kind,
    /** @type {string | undefined} */ detail = undefined,
  ) => {
    setErrorKind(kind);
    setErrorDetail(detail);
    setOffline(true);
    setPageLoading(false);
    setNavLoading(false);
    hideSplash();
  }, [hideSplash]);

  // a full page load that takes too long: stop it and offer Retry
  const slowTimer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const clearSlowTimer = useCallback(() => {
    if (slowTimer.current) clearTimeout(slowTimer.current);
    slowTimer.current = null;
  }, []);
  useEffect(() => clearSlowTimer, [clearSlowTimer]);

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
    setErrorKind("offline");
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
      if (!online) {
        setErrorKind("offline");
        setOffline(true);
      }
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

  // a server error retries by itself a few times (the screen stays up
  // with Retry meanwhile); a lost connection retries when it comes back
  const serverRetries = useRef(0);
  useEffect(() => {
    if (!offline) {
      serverRetries.current = 0;
      return;
    }
    if (errorKind !== "server" || serverRetries.current >= SERVER_RETRY_MS.length) return;
    const t = setTimeout(() => {
      serverRetries.current++;
      void retry();
    }, SERVER_RETRY_MS[serverRetries.current]);
    return () => clearTimeout(t);
  }, [offline, errorKind, retry]);

  // Android back: leaving the app always asks first
  const exitAsked = useRef(false);
  const confirmExit = useCallback(() => {
    if (exitAsked.current) return;
    exitAsked.current = true;
    Alert.alert(
      "Leave NR Management?",
      undefined,
      [
        { text: "Stay", style: "cancel", onPress: () => (exitAsked.current = false) },
        { text: "Leave", style: "destructive", onPress: () => BackHandler.exitApp() },
      ],
      { cancelable: true, onDismiss: () => (exitAsked.current = false) },
    );
  }, []);

  /** Back after the page had nothing open: history first, then ask to leave. */
  const historyBack = useCallback(() => {
    if (canGoBack.current && !isRootPage(currentUrl.current)) webRef.current?.goBack();
    else confirmExit();
  }, [confirmExit]);

  // Android hardware back / back gesture: first close what is open on the
  // page (dialog, menu), then page history, then ask before leaving
  const backTimer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const onBackReply = useCallback((/** @type {string} */ handled) => {
    if (!backTimer.current) return; // too late: the app already went on
    clearTimeout(backTimer.current);
    backTimer.current = null;
    if (!handled) historyBack();
  }, [historyBack]);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (offlineRef.current) {
        confirmExit();
        return true;
      }
      if (backTimer.current) return true; // still waiting for the page
      backTimer.current = setTimeout(() => {
        backTimer.current = null;
        historyBack(); // the page didn't answer (busy or not ours)
      }, BACK_REPLY_MS);
      webRef.current?.injectJavaScript("window.__nrBack&&window.__nrBack();true;");
      return true;
    });
    return () => {
      sub.remove();
      if (backTimer.current) clearTimeout(backTimer.current);
    };
  }, [confirmExit, historyBack]);

  // Android: keep the page above the keyboard. With edge-to-edge the window
  // may keep its full height under the keyboard, so the page is padded by
  // whatever height the window didn't give up itself (0 where it did).
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", (e) => setKeyboard(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const keyboardPad =
    Platform.OS === "android" && keyboard > 0
      ? Math.max(0, keyboard - insets.bottom - Math.max(0, openHeight - rootHeight))
      : 0;

  // push: channel up front, token rotation, taps while running
  useEffect(() => {
    void ensureChannel().catch(() => {});
    Notifications.clearLastNotificationResponse();
    const tokenSub = Notifications.addPushTokenListener(() => void registrar.current?.onTokenChanged());
    const tapSub = Notifications.addNotificationResponseReceivedListener((r) => {
      const url = urlFromNotification(r);
      if (url) navigate(url);
    });
    return () => {
      tokenSub.remove();
      tapSub.remove();
    };
  }, [navigate]);

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
      case "session":
        // trust session reports only from the website itself
        if (!String(e.nativeEvent.url || "").startsWith(`${POLICY.webOrigin}/`)) break;
        void registrar.current?.onSession({
          userId: typeof msg.userId === "string" ? msg.userId : null,
          accessToken: typeof msg.accessToken === "string" ? msg.accessToken : undefined,
        });
        {
          // signed in or out: make Android store the cookie change now, so
          // killing the app right after doesn't undo it
          const user = typeof msg.userId === "string" ? msg.userId : null;
          if (lastUser.current !== undefined && lastUser.current !== user && Platform.OS === "android") {
            setCookieFlush((n) => n + 1);
          }
          lastUser.current = user;
        }
        break;
      case "back":
        onBackReply(typeof msg.handled === "string" ? msg.handled : "");
        break;
      case "bg": {
        const hex = cssColorToHex(msg.value);
        if (hex) setBg(hex);
        break;
      }
      case "painted":
        hideSplash();
        break;
      case "nav":
        setNavLoading(msg.state === "start");
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
  }, [hideSplash, onBackReply]);

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: colors.bg, paddingBottom: insets.bottom + keyboardPad }]}
      edges={["top", "left", "right"]}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        setRootHeight(h);
        // portrait only: the tallest height seen is the window without a keyboard
        setOpenHeight((o) => Math.max(o, h));
      }}
    >
        <StatusBar style={colors.bars} />
        <NavigationBar style={colors.bars} />
        <View style={[styles.root, { backgroundColor: colors.bg }]}>
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
            onLoadStart={() => {
              setPageLoading(true);
              clearSlowTimer();
              slowTimer.current = setTimeout(() => {
                slowTimer.current = null;
                loadFailed.current = true;
                webRef.current?.stopLoading();
                showError("slow");
              }, SLOW_LOAD_MS);
            }}
            onLoadEnd={() => {
              clearSlowTimer();
              setPageLoading(false);
              setNavLoading(false);
              hideSplash();
            }}
            onLoad={() => {
              loadFailed.current = false;
            }}
            onError={(e) => {
              // the page itself failed to load (no network, DNS, TLS…)
              clearSlowTimer();
              loadFailed.current = true;
              showError("offline", e.nativeEvent.description);
            }}
            onHttpError={(e) => {
              // the website answered with a server error (main page only):
              // a native screen instead of a raw error page
              if (e.nativeEvent.statusCode < 500) return;
              clearSlowTimer();
              loadFailed.current = true;
              showError("server", `Error ${e.nativeEvent.statusCode}`);
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
            // app feel (the page side is in src/appFeel.js): no zoom, no
            // bounce or glow, no page scrollbars, no auto-linked numbers
            textZoom={100}
            setBuiltInZoomControls={false}
            setDisplayZoomControls={false}
            bounces={false}
            overScrollMode="never"
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            dataDetectorTypes="none"
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            webviewDebuggingEnabled={__DEV__}
            applicationNameForUserAgent={`NRManagement/1.0 (${Platform.OS})`}
            style={{ backgroundColor: colors.bg }}
          />
          <ProgressBar active={(pageLoading || navLoading) && !offline} color={colors.accent} />
          {offline ? (
            <OfflineScreen
              kind={errorKind}
              colors={colors}
              checking={checking}
              stillOffline={stillOffline}
              detail={errorDetail}
              onRetry={retry}
            />
          ) : null}
          {cookieFlush > 0 && Platform.OS === "android" ? (
            <CookieFlush key={cookieFlush} onDone={() => setCookieFlush(0)} />
          ) : null}
        </View>
    </SafeAreaView>
  );
}

/**
 * Android keeps cookie changes in memory for up to ~30 s before writing
 * them to disk, and only forces the write when a page finishes loading.
 * Sign-in and sign-out happen without a full page load, so a hidden,
 * zero-size WebView loads the website's dependency-free health check: its
 * page-finished event writes the cookies at once. Nothing is shown and no
 * data is read.
 * @param {{ onDone: () => void }} props
 */
function CookieFlush({ onDone }) {
  return (
    <WebView
      source={{ uri: `${WEB_URL}/api/health` }}
      style={styles.hidden}
      originWhitelist={["https://*"]}
      onShouldStartLoadWithRequest={(req) => decide(req.url, POLICY) === "load"}
      onLoadEnd={onDone}
      onError={onDone}
      javaScriptEnabled={false}
      sharedCookiesEnabled
      thirdPartyCookiesEnabled={false}
      cacheEnabled={false}
      mixedContentMode="never"
      allowFileAccess={false}
      setSupportMultipleWindows={false}
      importantForAccessibility="no-hide-descendants"
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0 },
});
