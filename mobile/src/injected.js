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
const { buildWatchdogScript } = require("./watchdog");

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
   * keep what the user typed. A page switch that was still waiting when
   * the phone slept is handed to the loading watchdog first (the app
   * reloads that page itself), and the website's server is woken up.
   */
  w.__nrResume = function (awayMs) {
    var watch = w.__nrWatch;
    var retrying = false;
    if (watch) {
      try {
        retrying = watch.resumed(awayMs);
        if (awayMs > 0) watch.warm();
      } catch (e) {
        retrying = false;
      }
    }
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
    var reload = !retrying && awayMs >= 30000 && isReadOnlyView();
    post({ type: "resumed", sockets: n, reload: reload });
    if (reload) location.reload();
  };

  // ── back button: close what is open on the page before leaving it ──────
  // Called by the app on Android back. An open dialog closes the way the
  // website closes it (Escape); the open mobile menu through its own
  // close button. Otherwise the app goes back in history or asks to exit.
  w.__nrBack = function () {
    var handled = "";
    try {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
        handled = "dialog";
      } else {
        var close = document.querySelector('button[aria-label="Close menu"]');
        if (close && close.getClientRects().length) {
          close.click();
          handled = "menu";
        }
      }
    } catch (e) {
      handled = "";
    }
    post({ type: "back", handled: handled });
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

  // ── colours and first paint: let the app match the page exactly ────────
  // The page's real background (whatever the website's CSS says) colours
  // the app around it; "painted" tells the app it can lift the splash.
  var lastBg = "";
  function reportBg() {
    try {
      var bg = document.body ? getComputedStyle(document.body).backgroundColor : "";
      if (bg && bg !== lastBg) {
        lastBg = bg;
        post({ type: "bg", value: bg });
      }
    } catch (e) {
      /* no body yet */
    }
  }
  function afterPaint(fn) {
    var raf = w.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    raf(function () { raf(fn); });
  }
  document.addEventListener("DOMContentLoaded", function () {
    afterPaint(function () {
      reportBg();
      post({ type: "painted" });
    });
  });
  try {
    new MutationObserver(function () { afterPaint(reportBg); }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class", "style"],
    });
  } catch (e) {
    /* no documentElement yet */
  }

  // ── navigation inside the website ──────────────────────────────────────
  // The website switches pages without a full load (client-side routing),
  // which the WebView doesn't see. The loading watchdog (src/watchdog.js)
  // follows each page switch and drives the app's progress bar; this only
  // decides what a page link is, and refreshes what the app knows after
  // the address changes. (The bar used to stop when the address changed,
  // which is when the website shows its loading skeleton, not its page.)
  function isPageLink(a, e) {
    if (!a || !a.href || a.hasAttribute("download")) return false;
    if (w.__nrApp.fileUrl && w.__nrApp.fileUrl(a)) return false;
    if (a.target && a.target !== "_self") return false;
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
    var u;
    try {
      u = new URL(a.href, location.href);
    } catch (err) {
      return false;
    }
    if (u.origin !== location.origin) return false;
    // a same-page #anchor is not a navigation
    return u.pathname + u.search !== location.pathname + location.search;
  }
  w.__nrApp.isPageLink = isPageLink;
  function navEnded() {
    reportSession();
    afterPaint(reportBg);
  }
  var H = w.history;
  ["pushState", "replaceState"].forEach(function (k) {
    var orig = H && H[k];
    if (typeof orig !== "function") return;
    H[k] = function () {
      var r = orig.apply(this, arguments);
      try { navEnded(); } catch (e) { /* never break the website's router */ }
      return r;
    };
  });
  if (w.addEventListener) w.addEventListener("popstate", navEnded);

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

  // ── files: the website's CSV and PDF downloads ─────────────────────────
  // A WebView can't save an attachment the way a browser does. A tap on one
  // of the website's own download links is caught here: the page fetches
  // the file itself (so the signed-in session cookie goes along, exactly as
  // in a browser) and hands it to the app in chunks, which saves it and
  // opens it in the phone's viewer or share sheet (WhatsApp, Drive, print).
  var FILE_PATHS = /^\/dashboard\/(orders\/csv|orders\/pdf|orders\/[0-9a-f-]{36}\/pdf|data\/export)\/?$/i;
  function fileUrl(a) {
    if (!a || !a.href) return null;
    var u;
    try {
      u = new URL(a.href, location.href);
    } catch (e) {
      return null;
    }
    if (u.origin !== location.origin) return null;
    var isDownload = typeof a.hasAttribute === "function" && a.hasAttribute("download");
    return isDownload || FILE_PATHS.test(u.pathname) ? u.href : null;
  }
  w.__nrApp.fileUrl = fileUrl;
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    var url = fileUrl(a);
    if (!url) return;
    // no browser download; the website's own click handlers still run
    e.preventDefault();
    w.__nrFetchFile(url);
  }, true);

  /** filename*=UTF-8''… or filename="…" from Content-Disposition, else the URL's last part */
  function fileName(cd, url) {
    var star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(cd || "");
    if (star) {
      try {
        return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
      } catch (e) {
        /* fall through */
      }
    }
    var plain = /filename\s*=\s*"([^"]+)"/.exec(cd || "") || /filename\s*=\s*([^;]+)/.exec(cd || "");
    if (plain) return plain[1].trim();
    return String(url).split(/[?#]/)[0].split("/").pop() || "download";
  }
  w.__nrApp.fileName = fileName;

  // base64 text per message: a big bulk PDF goes over in several pieces
  var CHUNK = 256 * 1024;
  var fileSeq = 0;
  w.__nrFetchFile = function (url) {
    var id = ++fileSeq;
    post({ type: "file-start", id: id });
    fetch(url, { credentials: "include", cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        var mime = (res.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
        // signed out meanwhile: the website redirected the request to its login page
        if (mime === "text/html") throw new Error("signed-out");
        var name = fileName(res.headers.get("content-disposition"), url);
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
        if (!f.data) throw new Error("empty file");
        var n = Math.ceil(f.data.length / CHUNK);
        for (var i = 0; i < n; i++) {
          post({ type: "file-chunk", id: id, i: i, n: n, data: f.data.slice(i * CHUNK, (i + 1) * CHUNK) });
        }
        post({ type: "file-end", id: id, name: f.name, mime: f.mime, chunks: n });
      })
      .catch(function (e) {
        var message = String((e && e.message) || e);
        post({ type: "file-error", id: id, message: message, signedOut: message === "signed-out" });
      });
  };
})();
true;`;

/**
 * The script handed to `injectedJavaScriptBeforeContentLoaded`: the app
 * bridge, the loading watchdog (src/watchdog.js), then the app-feel tweaks
 * (src/appFeel.js).
 * @param {Partial<import('./appFeel').AppFeelFlags>} [appFeel]
 */
function buildInjectedScript(appFeel) {
  return `${PAGE_SCRIPT}\n${buildWatchdogScript()}\n${buildAppFeelScript(appFeel)}`;
}

module.exports = { buildInjectedScript };
