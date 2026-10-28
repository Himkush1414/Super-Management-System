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
import { saveAndOpenFile } from "./src/files";
import { createAssembler } from "./src/fileAssembler";
import { createPushRegistrar, ensureChannel } from "./src/push";
import * as Application from "expo-application";
import { MAX_MS as WATCH_MAX_MS, STALL_MS } from "./src/watchdog";
import { addEntry, createLoadState, onStuck, pathOnly, retryHow } from "./src/loading";
import { loadLog, saveLog } from "./src/diagnosticsStore";
import { Diagnostics } from "./src/Diagnostics";

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
/** A page switch that never reports back stops the bar (the watchdog reports first). */
const NAV_MAX_MS = WATCH_MAX_MS + 5000;
/**
 * A full page load whose page never even started (no first byte, so the
 * page watchdog isn't running) counts as stuck after the watchdog's own
 * stall time. Once the page reports in, the watchdog takes over.
 */
const NO_START_MS = STALL_MS;
/** Backstop: a full page load still going after this counts as stuck. */
const SLOW_LOAD_MS = WATCH_MAX_MS + 5000;
/** The warm-up ping to the website's health check gives up after this. */
const WARMUP_TIMEOUT_MS = 8000;

const APP_VERSION = `${Application.nativeApplicationVersion ?? "?"} (${Application.nativeBuildVersion ?? "?"})`;

/**
 * Wake the website's server (a cold start costs about a second) with its
 * dependency-free health check: no cookies, no sign-in, no data.
 * @returns {Promise<{ ms: number, ok: boolean, note: string }>}
 */
async function warmUp() {
  const t = Date.now();
  const ctl = new AbortController();
  const stop = setTimeout(() => ctl.abort(), WARMUP_TIMEOUT_MS);
  try {
    const r = await fetch(`${WEB_URL}/api/health`, { cache: "no-store", credentials: "omit", signal: ctl.signal });
    return { ms: Date.now() - t, ok: r.ok, note: `app, HTTP ${r.status}` };
  } catch (e) {
    return { ms: Date.now() - t, ok: false, note: `app, ${/** @type {any} */ (e)?.name ?? "failed"}` };
  } finally {
    clearTimeout(stop);
  }
}
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
  const backgroundedAt = useRef(/** @type {number | null} */ (null));

  // cold start from a notification tap: open that order directly
  const [startUrl] = useState(() => urlFromNotification(Notifications.getLastNotificationResponse()) ?? START_URL);
  const currentUrl = useRef(startUrl);
  const registrar = useRef(/** @type {ReturnType<typeof createPushRegistrar> | null} */ (null));
  if (registrar.current === null) registrar.current = createPushRegistrar();
  // the page's own background colour: cached from the last run, so the
  // first frame already matches (no white flash, no wrong-coloured bars)
  const [bg, setBg] = useState(() => loadCachedBg() ?? DEFAULT_BG);
  const [pageLoading, setPageLoading] = useState(false);
  const [navLoading, setNavLoading] = useState(false);
  // a CSV/PDF on its way from the page (shows the progress bar)
  const [downloading, setDownloading] = useState(false);
  const [assembler] = useState(createAssembler);
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

  // the hidden Diagnostics screen: recent navigations, kept on the phone
  const [navLog, setNavLog] = useState(loadLog);
  const [diagnostics, setDiagnostics] = useState(false);
  const [webAgent, setWebAgent] = useState("");
  useEffect(() => saveLog(navLog), [navLog]);
  const record = useCallback((/** @type {import('./src/loading').LogEntry} */ entry) => {
    setNavLog((log) => addEntry(log, entry));
  }, []);
  // the last automatic retry of a stuck page (one per address per minute)
  const lastRetry = useRef(/** @type {import('./src/loading').RetryMark | null} */ (null));

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

  // A link that opens the app from cold arrives before the first page has
  // loaded, when there is no page yet to run it in (it was dropped and the
  // app stayed on the start page). It waits here and opens once a page has
  // loaded.
  const pageLoaded = useRef(false);
  const pendingLink = useRef(/** @type {string | null} */ (null));
  const openWhenLoaded = useCallback((/** @type {string} */ url) => {
    if (pageLoaded.current) navigate(url);
    else pendingLink.current = url;
  }, [navigate]);

  // whether the current page failed to load (vs. the network dropping
  // under a page that is still there, with whatever the user typed), and
  // the automatic retries of a server error (src/loading.js)
  const [load] = useState(createLoadState);

  // ── full page loads ────────────────────────────────────────────────────
  // Android's onLoadStart doesn't mark a full load: react-native-webview
  // sends it from doUpdateVisitedHistory, i.e. for every address change
  // inside the website too (each tab switch, each live refresh). The
  // WebView follows those with onPageFinished, so the old 20 s timer on
  // onLoadStart was cleared again (checked on the emulator); still, it
  // treated every tab switch as a page load. So a full load is timed from
  // where it is asked for (start, reload, a link that leaves the page, a
  // retry) until the page reports in: its first byte has arrived and its
  // watchdog (src/watchdog.js) takes over.
  const noStartTimer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const clearNoStartTimer = useCallback(() => {
    if (noStartTimer.current) clearTimeout(noStartTimer.current);
    noStartTimer.current = null;
  }, []);
  useEffect(() => clearNoStartTimer, [clearNoStartTimer]);
  // the page has been shown (its watchdog said so) since the last load began
  const pageShown = useRef(false);
  // the stuck handler below, for timers armed before it existed
  const stuckRef = useRef((/** @type {{ kind: string, href: string, ms?: number, reason?: string }} */ _s) => {});

  /** A full load of `url` is on its way (`how` starts it, if the app does). */
  const startLoad = useCallback((/** @type {string} */ url, /** @type {"reload" | "assign" | null} */ how) => {
    clearSlowTimer();
    clearNoStartTimer();
    load.started();
    pageShown.current = false;
    setPageLoading(true);
    noStartTimer.current = setTimeout(() => {
      noStartTimer.current = null;
      stuckRef.current({ kind: "load", href: url, ms: NO_START_MS, reason: "no answer from the website" });
    }, NO_START_MS);
    slowTimer.current = setTimeout(() => {
      slowTimer.current = null;
      // shown but still loading something (an image, a font): leave it be
      if (pageShown.current) setPageLoading(false);
      else stuckRef.current({ kind: "load", href: url, ms: SLOW_LOAD_MS, reason: "the page did not finish" });
    }, SLOW_LOAD_MS);
    if (how === "reload") webRef.current?.reload();
    else if (how === "assign") navigate(url);
  }, [clearSlowTimer, clearNoStartTimer, load, navigate]);

  /**
   * A page stuck loading (reported by the page watchdog, or a full load
   * that never started): load that address once more, and if it sticks
   * again within a minute, the error screen with Retry. Never a loop.
   */
  const onPageStuck = useCallback((
    /** @type {{ kind: string, href: string, ms?: number, reason?: string }} */ s,
  ) => {
    clearSlowTimer();
    clearNoStartTimer();
    const href = decide(s.href, POLICY) === "load" ? s.href : currentUrl.current;
    const { action, mark } = onStuck(lastRetry.current, href, Date.now());
    lastRetry.current = mark;
    record({
      at: Date.now() - (s.ms ?? 0),
      kind: s.kind,
      path: pathOnly(href),
      ms: s.ms ?? null,
      result: action === "retry" ? "retried" : "stuck",
      note: s.reason,
    });
    if (action === "retry") {
      // a fresh full load of that address: the WebView's own reload when
      // it already shows it (see retryHow), else the link from the page
      startLoad(href, retryHow(href, currentUrl.current));
      return;
    }
    load.loadError();
    webRef.current?.stopLoading();
    showError("slow");
  }, [clearSlowTimer, clearNoStartTimer, load, record, showError, startLoad]);
  useEffect(() => {
    stuckRef.current = onPageStuck;
  }, [onPageStuck]);

  // the first page: the WebView starts it as it mounts
  useEffect(() => {
    startLoad(startUrl, null);
  }, [startLoad, startUrl]);

  // wake the website's server while the first page loads
  useEffect(() => {
    void warmUp().then((r) => record({ at: Date.now() - r.ms, kind: "warmup", path: "/api/health", ms: r.ms, result: r.ok ? "ok" : "failed", note: `${r.note}, launch` }));
  }, [record]);

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
    if (load.failed) startLoad(currentUrl.current, "reload");
    else webRef.current?.injectJavaScript("window.__nrResume&&window.__nrResume(0);true;");
  }, [load, startLoad]);

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

  // back to the foreground: retry if offline; else check the connection
  // again, then (src/injected.js) hand a page switch that was waiting when
  // the phone slept to the watchdog, wake the server through the WebView's
  // own connection, nudge realtime and let read-only pages refresh
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        backgroundedAt.current = Date.now();
        return;
      }
      if (state !== "active" || backgroundedAt.current === null) return;
      const away = Date.now() - backgroundedAt.current;
      backgroundedAt.current = null;
      if (offlineRef.current) {
        void retry();
        return;
      }
      if (away < RESUME_NUDGE_MS) return;
      void NetInfo.fetch()
        .catch(() => null)
        .then((s) => {
          const online = !s || isOnline(s);
          record({ at: Date.now(), kind: "resume", path: "", ms: away, result: online ? "online" : "offline", note: `away ${Math.round(away / 1000)} s` });
          if (!online) {
            setErrorKind("offline");
            setOffline(true);
            return;
          }
          webRef.current?.injectJavaScript(`window.__nrResume&&window.__nrResume(${away});true;`);
        });
    });
    return () => sub.remove();
  }, [retry, record]);

  // a server error retries by itself a few times, waiting longer each time
  // (the screen stays up with Retry meanwhile); a lost connection retries
  // when it comes back
  useEffect(() => {
    if (!offline || errorKind !== "server") return;
    const wait = load.nextServerRetry();
    if (wait === null) return;
    const t = setTimeout(() => {
      load.serverRetried();
      void retry();
    }, wait);
    return () => clearTimeout(t);
  }, [offline, errorKind, load, retry]);

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
      if (path) openWhenLoaded(deepLink(path, POLICY));
    };
    void Linking.getInitialURL().then(open).catch(() => {});
    const sub = Linking.addEventListener("url", (e) => open(e.url));
    return () => sub.remove();
  }, [openWhenLoaded]);

  /** @type {(req: import('react-native-webview/lib/WebViewTypes').ShouldStartLoadRequest) => boolean} */
  const onShouldStart = useCallback((req) => {
    const d = decide(req.url, POLICY);
    if (d === "external") void Linking.openURL(req.url).catch(() => {});
    // the page leaves for a new full load (Android asks only for those,
    // never for the website's own tab switches)
    else if (d === "load" && req.isTopFrame && !req.url.startsWith("about:")) startLoad(req.url, null);
    return d === "load";
  }, [startLoad]);

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
        // a full load's first byte: the page's watchdog follows it from here
        if (msg.kind === "load" && msg.state === "start") {
          clearNoStartTimer();
          setPageLoading(true);
        }
        // the page is on screen. For a very small page this "start" can
        // arrive after onLoadEnd, so only this "end" stops its bar
        if (msg.kind === "load" && msg.state === "end") setPageLoading(false);
        setNavLoading(msg.state === "start");
        break;
      case "resumed":
        // the page reloads itself (a read-only page after time away)
        if (msg.reload) startLoad(currentUrl.current, null);
        break;
      case "nav-log":
        if (msg.kind === "load") pageShown.current = true;
        record({
          at: Date.now() - (Number(msg.ms) || 0),
          kind: String(msg.kind),
          path: String(msg.path),
          ms: Number(msg.ms),
          result: String(msg.result),
        });
        break;
      case "nav-stuck":
        onPageStuck({
          kind: String(msg.kind),
          href: String(msg.href),
          ms: Number(msg.ms) || 0,
          reason: `${msg.skeleton ? "skeleton, " : ""}${String(msg.reason || "")}`,
        });
        break;
      case "warmup":
        record({
          at: Date.now() - (Number(msg.ms) || 0),
          kind: "warmup",
          path: "/api/health",
          ms: Number(msg.ms),
          result: msg.ok ? "ok" : "failed",
          note: `page, ${msg.ok ? `HTTP ${msg.status}` : String(msg.error || msg.status || "")}, resume`,
        });
        break;
      case "env":
        if (typeof msg.ua === "string") setWebAgent(msg.ua.slice(0, 300));
        break;
      case "blob-download-blocked":
        Alert.alert(
          "Not available in the app",
          "This file can only be downloaded on the website in a computer browser. Nothing was deleted.",
        );
        break;
      case "file-start":
        assembler.start(msg.id);
        setDownloading(true);
        break;
      case "file-chunk":
        if (!assembler.chunk(msg)) setDownloading(false);
        break;
      case "file-end": {
        setDownloading(false);
        const f = assembler.end(msg);
        if (!f) {
          Alert.alert("Download failed", "The file could not be downloaded. Please try again.");
          break;
        }
        void saveAndOpenFile(f).catch(() =>
          Alert.alert("Download failed", "The file could not be saved. Please try again."),
        );
        break;
      }
      case "file-error":
        assembler.drop(msg.id);
        setDownloading(false);
        Alert.alert(
          "Download failed",
          msg.signedOut
            ? "You were signed out. Sign in again, then download the file."
            : msg.timedOut
              ? "The file took too long to arrive. Please try again."
              : "The file could not be downloaded. Please try again.",
        );
        break;
      default:
        break;
    }
  }, [hideSplash, onBackReply, assembler, clearNoStartTimer, record, onPageStuck, startLoad]);

  /** @type {[string, string][]} */
  const about = useMemo(() => [
    ["App", `NR Management ${APP_VERSION}`],
    ["Package", Application.applicationId ?? "?"],
    ["Website", WEB_URL],
    ["Android", `API ${Platform.Version}`],
    ["WebView", webAgent || "(not reported yet)"],
    ["Cache", "default: the website's headers decide (pages no-store, scripts and styles cached)"],
    ["JavaScript", "on; DOM storage on"],
    ["Cookies", "shared with the app; third-party off"],
    ["Security", "HTTPS only, mixed content never, file access off, extra windows off"],
    ["Rendering", "hardware accelerated (default layer), text zoom 100%"],
    ["Watchdog", `stuck after ${STALL_MS / 1000} s without change (max ${WATCH_MAX_MS / 1000} s); 1 automatic retry per page per minute`],
  ], [webAgent]);

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
            // no onLoadStart: on Android it also fires for every address
            // change inside the website (see startLoad above)
            onLoadEnd={() => {
              clearSlowTimer();
              clearNoStartTimer();
              setPageLoading(false);
              setNavLoading(false);
              hideSplash();
            }}
            onLoad={() => {
              load.finished();
              if (load.failed) return;
              pageLoaded.current = true;
              const link = pendingLink.current;
              pendingLink.current = null;
              if (link) navigate(link);
            }}
            onError={(e) => {
              // the page itself failed to load (no network, DNS, TLS…)
              clearSlowTimer();
              clearNoStartTimer();
              load.loadError();
              showError("offline", e.nativeEvent.description);
            }}
            onHttpError={(e) => {
              // the website answered with a server error (main page only):
              // a native screen instead of a raw error page
              if (e.nativeEvent.statusCode < 500) return;
              clearSlowTimer();
              clearNoStartTimer();
              load.serverError();
              showError("server", `Error ${e.nativeEvent.statusCode}`);
            }}
            // the offline screen covers failures; never flash the default red error text
            renderError={() => <View style={[styles.root, { backgroundColor: colors.bg }]} />}
            onRenderProcessGone={() => webRef.current?.reload()}
            onContentProcessDidTerminate={() => webRef.current?.reload()}
            onFileDownload={({ nativeEvent }) => {
              // iOS only, for an attachment the page's own catch missed:
              // fetch it inside the page so the session cookie goes along
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
            // the website's own headers decide: its pages are never stored
            // (no-store / revalidate), only its scripts and styles (immutable)
            cacheEnabled
            cacheMode="LOAD_DEFAULT"
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
            // an array: Android passes this prop to native as-is and a plain
            // string crashes it (iOS converts a string itself)
            dataDetectorTypes={["none"]}
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            webviewDebuggingEnabled={__DEV__}
            applicationNameForUserAgent={`NRManagement/1.0 (${Platform.OS})`}
            style={{ backgroundColor: colors.bg }}
          />
          <ProgressBar active={(pageLoading || navLoading || downloading) && !offline} color={colors.accent} />
          {offline ? (
            <OfflineScreen
              kind={errorKind}
              colors={colors}
              checking={checking}
              stillOffline={stillOffline}
              detail={errorDetail}
              version={APP_VERSION}
              onRetry={() => {
                load.retryTapped();
                void retry();
              }}
              onDiagnostics={() => setDiagnostics(true)}
            />
          ) : null}
          <Diagnostics
            visible={diagnostics}
            log={navLog}
            about={about}
            colors={colors}
            onClear={() => setNavLog([])}
            onClose={() => setDiagnostics(false)}
          />
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
