// @ts-check
// JavaScript the app injects into every page of the website, before the
// page's own scripts run. It never changes what the website does on its
// own; it only reports to the app (theme, who is signed in, blocked
// downloads, files) and lets the app nudge the realtime connection after
// a resume.
//
// Pure string builder (no React Native imports) so tests can run it in a
// sandbox with `node --test`.

const { buildAppFeelScript } = require("./appFeel");

// Hermes compiles release bundles to bytecode, so Function#toString() can't
// be used to ship page code: it is a plain string. String.raw keeps the
// regex backslashes verbatim (the text has no backticks or interpolation).
const PAGE_SCRIPT = String.raw`(function () {
  var w = window;
  if (w.__nrApp) return;
  w.__nrApp = { version: 1 };

  function post(msg) {
    try {
      w.ReactNativeWebView.postMessage(JSON.stringify(msg));
    } catch (e) {
      /* not inside the app */
    }
  }
  w.__nrApp.post = post;

  // ── realtime: remember the Supabase sockets the website opens ──────────
  var sockets = [];
  var NativeWS = w.WebSocket;
  if (NativeWS) {
    var Wrapped = function (url, protocols) {
      var ws = protocols === undefined ? new NativeWS(url) : new NativeWS(url, protocols);
      if (String(url).indexOf("/realtime/v1/websocket") !== -1) {
        sockets.push(ws);
        ws.addEventListener("close", function () {
          var i = sockets.indexOf(ws);
          if (i !== -1) sockets.splice(i, 1);
        });
      }
      return ws;
    };
    Wrapped.prototype = NativeWS.prototype;
    Wrapped.CONNECTING = 0;
    Wrapped.OPEN = 1;
    Wrapped.CLOSING = 2;
    Wrapped.CLOSED = 3;
    w.WebSocket = Wrapped;
  }

  /** Pages with nothing the user could be typing into. */
  function isReadOnlyView() {
    var p = location.pathname.replace(/\/+$/, "");
    var view =
      p === "/dashboard" ||
      p === "/dashboard/orders" ||
      p === "/dashboard/activity" ||
      /^\/dashboard\/orders\/[0-9a-f-]{36}$/i.test(p);
    if (!view) return false;
    if (document.querySelector('[role="dialog"],[aria-modal="true"],dialog[open]')) return false;
    var a = document.activeElement;
    return !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  }

  /**
   * Called by the app when it returns to the foreground or the network
   * comes back. A socket that died while the phone slept still looks open
   * until a heartbeat is missed (up to ~30 s), so hand it to the realtime
   * client's own close handler now: it reconnects after its first backoff
   * step (1 s) and rejoins every channel. Realtime does not replay events
   * missed while away, so read-only pages also reload; pages with a form
   * keep what the user typed.
   */
  w.__nrResume = function (awayMs) {
    var n = 0;
    sockets.slice().forEach(function (ws) {
      var handler = ws.onclose;
      try {
        ws.close(4001, "app resume");
      } catch (e) {
        /* already closing */
      }
      if (typeof handler === "function") {
        n++;
        try {
          handler.call(ws, { code: 4001, reason: "app resume", wasClean: false });
        } catch (e) {
          /* the client replaced its handler */
        }
      }
    });
    var reload = awayMs >= 30000 && isReadOnlyView();
    post({ type: "resumed", sockets: n, reload: reload });
    if (reload) location.reload();
  };

  // ── theme: let the app colour the status bar like the page ─────────────
  function theme() {
    return document.documentElement && document.documentElement.getAttribute("data-theme") === "light"
      ? "light"
      : "dark";
  }
  var lastTheme = "";
  function reportTheme() {
    var t = theme();
    if (t !== lastTheme) {
      lastTheme = t;
      post({ type: "theme", value: t });
    }
  }
  try {
    new MutationObserver(reportTheme).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  } catch (e) {
    /* no documentElement yet */
  }
  document.addEventListener("DOMContentLoaded", reportTheme);
  reportTheme();

  // ── downloads built in the page (blob: URLs) ───────────────────────────
  // A WebView cannot save a blob: download. The website's account reset
  // flow ("Download this data", then delete) treats a returning a.click()
  // as "the copy is in hand" and deletes right after, so in the app the
  // click must FAIL: the website then shows "The download failed, so
  // nothing was deleted." and keeps the data.
  var anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.href && this.href.indexOf("blob:") === 0) {
      post({ type: "blob-download-blocked", name: this.download || "" });
      throw new Error("This download is not available in the app.");
    }
    return anchorClick.apply(this, arguments);
  };

  // ── session: who is signed in, read from the website's own cookie ──────
  // @supabase/ssr keeps the session in sb-<project>-auth-token (split into
  // .0, .1 … when long), as JSON or "base64-" + base64url(JSON). Only the
  // user id and access token go to the app (to register this phone for
  // that user's notifications); the refresh token never leaves the page.
  function b64urlDecode(str) {
    var b = str.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    var bin = atob(b);
    try {
      return decodeURIComponent(
        bin
          .split("")
          .map(function (c) {
            return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
          })
          .join(""),
      );
    } catch (e) {
      return bin;
    }
  }
  function readSession() {
    var whole = null;
    var chunks = {};
    var found = false;
    String(document.cookie || "")
      .split(/;\s*/)
      .forEach(function (pair) {
        var i = pair.indexOf("=");
        if (i < 1) return;
        var m = /^sb-[A-Za-z0-9]+-auth-token(?:\.(\d+))?$/.exec(pair.slice(0, i));
        if (!m) return;
        found = true;
        if (m[1] === undefined) whole = pair.slice(i + 1);
        else chunks[m[1]] = pair.slice(i + 1);
      });
    if (!found) return null;
    var raw = whole;
    if (raw === null) {
      raw = "";
      for (var n = 0; chunks[n] !== undefined; n++) raw += chunks[n];
    }
    try {
      raw = decodeURIComponent(raw);
    } catch (e) {
      /* already plain */
    }
    if (raw.indexOf("base64-") === 0) raw = b64urlDecode(raw.slice(7));
    var s = JSON.parse(raw);
    var at = s && s.access_token;
    if (!at) return null;
    var claims = JSON.parse(b64urlDecode(at.split(".")[1] || ""));
    if (!claims || !claims.sub) return null;
    return { userId: claims.sub, accessToken: at, expiresAt: s.expires_at || claims.exp || null };
  }
  var lastSession = null;
  function reportSession() {
    var s = null;
    try {
      s = readSession();
    } catch (e) {
      s = null;
    }
    var key = s ? s.userId + "|" + s.accessToken : "";
    if (key === lastSession) return;
    lastSession = key;
    post(s ? { type: "session", userId: s.userId, accessToken: s.accessToken, expiresAt: s.expiresAt } : { type: "session", userId: null });
  }
  w.__nrApp.reportSession = reportSession;
  document.addEventListener("DOMContentLoaded", reportSession);
  document.addEventListener("visibilitychange", reportSession);
  // the token refreshes in the background (about hourly): notice it. A
  // local cookie read every 15 s; no network involved.
  setInterval(reportSession, 15000);
  reportSession();

  // ── iOS: fetch a same-site attachment with the session, hand it over ────
  w.__nrFetchFile = function (url) {
    fetch(url, { credentials: "include", cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        var cd = res.headers.get("content-disposition") || "";
        var m = /filename="([^"]+)"/.exec(cd);
        var name = m ? m[1] : url.split("?")[0].split("/").pop() || "download";
        var mime = res.headers.get("content-type") || "application/octet-stream";
        return res.blob().then(function (b) {
          return new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onload = function () {
              resolve({ name: name, mime: mime, data: String(r.result).split(",")[1] || "" });
            };
            r.onerror = function () {
              reject(r.error);
            };
            r.readAsDataURL(b);
          });
        });
      })
      .then(function (f) {
        post(Object.assign({ type: "file" }, f));
      })
      .catch(function (e) {
        post({ type: "file-error", message: String((e && e.message) || e) });
      });
  };
})();
true;`;

/**
 * The script handed to `injectedJavaScriptBeforeContentLoaded`: the app
 * bridge, then the app-feel tweaks (src/appFeel.js).
 * @param {Partial<import('./appFeel').AppFeelFlags>} [appFeel]
 */
function buildInjectedScript(appFeel) {
  return `${PAGE_SCRIPT}\n${buildAppFeelScript(appFeel)}`;
}

module.exports = { buildInjectedScript };
