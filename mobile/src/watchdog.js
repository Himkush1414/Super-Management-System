// @ts-check
// Loading watchdog: page code injected with the rest of the app's page
// script (src/injected.js).
//
// Why it exists: the website switches tabs without a full page load.
// Next.js puts the tab's loading skeleton on screen at once, then waits
// for the server's answer with no time limit. One request that never
// answers (a connection that died while the phone slept, a server call
// that hangs) leaves the skeleton up for good, and the WebView itself
// sees nothing loading, so the app never noticed.
//
// What it does: each navigation (a tap on a page link, the router moving
// to a new address, back/forward, a full page load) is watched until the
// new page is on screen: the address has moved, the page has changed, and
// no loading skeleton (the website's loading.tsx, [aria-busy="true"]) is
// left. A navigation that goes STALL_MS without any change on the page
// while still loading is reported to the app ("nav-stuck"); the app
// retries once and then shows its error screen with Retry (App.js). Every
// navigation is also reported for the hidden Diagnostics screen: kind,
// path (never the query string), time and result.
//
// It only watches. It never changes the page, delays the router or holds
// up a request. Pure string builder (no React Native imports), so tests
// can run it in a sandbox with `node --test`.

/** No change on the page for this long while still loading = stuck. */
const STALL_MS = 8000;
/** Even a page that keeps changing must have finished by then. */
const MAX_MS = 25000;
/** How often an unfinished navigation is checked. */
const TICK_MS = 500;
/** The website's loading skeletons (app/dashboard/loading.tsx, orders/[id]/loading.tsx). */
const SKELETON = '[aria-busy="true"]';

function buildWatchdogScript() {
  // String.raw: Hermes ships bytecode, so page code is a plain string (see
  // src/injected.js). No backticks inside; the constants are inlined.
  return String.raw`(function () {
  var w = window;
  // window timers are the clock; without them (not a browser) do nothing
  if (w.__nrWatch || typeof w.setTimeout !== "function") return;
  var d = document;
  var STALL_MS = ${STALL_MS};
  var MAX_MS = ${MAX_MS};
  var TICK_MS = ${TICK_MS};
  var SKELETON = ${JSON.stringify(SKELETON)};

  function post(msg) {
    try {
      w.ReactNativeWebView.postMessage(JSON.stringify(msg));
    } catch (e) {
      /* not inside the app */
    }
  }
  function now() {
    return Date.now();
  }
  function here() {
    return location.pathname + location.search;
  }
  function pathOf(href) {
    try {
      return new URL(href, location.href).pathname;
    } catch (e) {
      return "";
    }
  }
  function busy() {
    try {
      return !!d.querySelector(SKELETON);
    } catch (e) {
      return false;
    }
  }

  var seq = 0;
  var cur = null;
  var timer = null;

  function stopTimer() {
    if (timer !== null) w.clearTimeout(timer);
    timer = null;
  }

  /** The new page is on screen. */
  function isDone() {
    if (cur.kind === "load") return d.readyState !== "loading" && !busy();
    if (!cur.moved && here() !== cur.from) cur.moved = true;
    return cur.moved && cur.changed && !busy();
  }

  function report(result) {
    var c = cur;
    cur = null;
    stopTimer();
    post({ type: "nav", state: "end", kind: c.kind });
    post({ type: "nav-log", kind: c.kind, path: c.path, ms: now() - c.t0, result: result });
  }

  function stuck(reason) {
    var c = cur;
    cur = null;
    stopTimer();
    post({ type: "nav", state: "end", kind: c.kind });
    post({
      type: "nav-stuck",
      kind: c.kind,
      path: c.path,
      // where to retry: the address the page moved to, or the tapped link
      href: c.moved || c.kind !== "click" ? location.href : c.href,
      ms: now() - c.t0,
      skeleton: busy(),
      reason: reason,
    });
  }

  function check() {
    timer = null;
    if (!cur) return;
    if (isDone()) return report("ok");
    var t = now();
    if (t - cur.last >= STALL_MS) return stuck("no change for " + Math.round((t - cur.last) / 1000) + " s");
    if (t - cur.t0 >= MAX_MS) return stuck("not finished after " + Math.round((t - cur.t0) / 1000) + " s");
    timer = w.setTimeout(check, TICK_MS);
  }

  function begin(kind, href) {
    if (cur) report("replaced"); // the user moved on before it finished
    var t = now();
    cur = {
      kind: kind,
      href: href,
      path: pathOf(href),
      from: here(),
      t0: t,
      last: t,
      changed: false,
      // these start at their new address already
      moved: kind !== "click",
    };
    seq++;
    post({ type: "nav", state: "start", kind: kind });
    stopTimer();
    timer = w.setTimeout(check, TICK_MS);
  }

  // ── what counts as a change on the page ────────────────────────────────
  // Nodes added, removed or retyped; attributes are left out (hover and
  // pulse classes change all the time and mean nothing here).
  try {
    new w.MutationObserver(function () {
      if (!cur) return;
      cur.changed = true;
      cur.last = now();
      if (isDone()) report("ok");
    }).observe(d, { childList: true, subtree: true, characterData: true });
  } catch (e) {
    /* no MutationObserver: only the timer checks remain, still bounded */
  }

  // ── where navigations start ────────────────────────────────────────────
  // a tap on a same-site page link (the same rules as the app bridge)
  d.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    var app = w.__nrApp;
    if (a && app && app.isPageLink && app.isPageLink(a, e)) begin("click", a.href);
  }, true);
  // the router moving to a new address without a tap (after a form, a
  // redirect); during a tap's navigation it only marks the move
  var H = w.history;
  var push = H && H.pushState;
  if (typeof push === "function") {
    H.pushState = function () {
      var r = push.apply(this, arguments);
      try {
        if (cur) cur.moved = true;
        else begin("push", location.href);
      } catch (e) {
        /* never break the website's router */
      }
      return r;
    };
  }
  w.addEventListener("popstate", function () {
    begin("pop", location.href);
  });
  // this page itself: watched from the first byte until it is on screen
  begin("load", location.href);
  d.addEventListener("DOMContentLoaded", function () {
    if (cur && isDone()) report("ok");
    post({ type: "env", ua: String((w.navigator && w.navigator.userAgent) || "") });
  });

  w.__nrWatch = {
    /**
     * Back from the background. Timers sleep with the app, and a request
     * that was waiting when the phone slept is very likely dead: an
     * unfinished navigation is reported at once. True if one was.
     */
    resumed: function (awayMs) {
      if (!cur || awayMs < 1000) return false;
      if (isDone()) {
        report("ok");
        return false;
      }
      stuck("waiting when the app went to the background");
      return true;
    },
    /**
     * Wake the website's server and check the WebView's own connection
     * to it (the app's warm-up ping can't reach the WebView's sockets).
     * No sign-in, no data: the dependency-free health check.
     */
    warm: function () {
      var t = now();
      var ctl = typeof AbortController === "function" ? new AbortController() : null;
      var stop = ctl ? w.setTimeout(function () { ctl.abort(); }, 10000) : null;
      fetch(location.origin + "/api/health", { cache: "no-store", credentials: "omit", signal: ctl ? ctl.signal : undefined })
        .then(function (r) {
          post({ type: "warmup", where: "page", ms: now() - t, ok: r.ok, status: r.status });
        })
        .catch(function (e) {
          post({ type: "warmup", where: "page", ms: now() - t, ok: false, error: String((e && e.name) || e) });
        })
        .then(function () {
          if (stop !== null) w.clearTimeout(stop);
        });
    },
    /** For tests and the diagnostics: what is being watched now. */
    current: function () {
      return cur ? { kind: cur.kind, path: cur.path, ms: now() - cur.t0, moved: cur.moved, changed: cur.changed, skeleton: busy() } : null;
    },
    count: function () {
      return seq;
    },
  };
})();
true;`;
}

module.exports = { STALL_MS, MAX_MS, TICK_MS, SKELETON, buildWatchdogScript };
