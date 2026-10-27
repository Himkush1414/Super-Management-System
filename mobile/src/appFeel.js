// @ts-check
// Makes the website feel like an app inside the WebView: no pinch zoom,
// no rubber-band scrolling, no sideways page drag, no tap flash, no
// long-press menus on buttons and links, text selection only where it is
// useful, and inputs that stay above the keyboard.
//
// Everything is injected at runtime by the app; the website itself is not
// changed and looks exactly the same in a normal browser. Each tweak has
// its own flag in APP_FEEL, so a single one can be switched off quickly
// if it ever gets in the way.
//
// Pure string builder (no React Native imports) so tests can run it in a
// sandbox with `node --test`.

/**
 * @typedef {{
 *   viewportLock: boolean,
 *   noOverscroll: boolean,
 *   noHorizontalDrag: boolean,
 *   noTapHighlight: boolean,
 *   fastTap: boolean,
 *   noCallout: boolean,
 *   selectionOnlyWhereUseful: boolean,
 *   noImageDrag: boolean,
 *   keyboardScroll: boolean,
 * }} AppFeelFlags
 */

/** @type {Readonly<AppFeelFlags>} */
const APP_FEEL = Object.freeze({
  // viewport: width=device-width, initial-scale=1, maximum-scale=1,
  // user-scalable=no, viewport-fit=cover; iOS pinch gestures cancelled
  viewportLock: true,
  // no bounce / overscroll glow on the page itself
  noOverscroll: true,
  // the page never drags sideways; tables that scroll in their own box still do
  noHorizontalDrag: true,
  // no grey/blue flash on tap
  noTapHighlight: true,
  // no double-tap zoom, so no 300 ms wait before a tap counts
  fastTap: true,
  // no long-press menu (open in new tab, copy link, save image) on links,
  // buttons and images; inputs keep theirs, so paste still works
  noCallout: true,
  // text selection only in form fields and table cells
  selectionOnlyWhereUseful: true,
  // images and links can't be dragged around
  noImageDrag: true,
  // a focused input scrolls into view when the keyboard opens
  keyboardScroll: true,
});

const VIEWPORT = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";

/** Elements a long press must not open a menu on. */
const NO_CALLOUT = "a, button, img, svg, [role=button], [role=link], [role=menuitem], label";
/** Where text can still be selected. */
const SELECTABLE = "input, textarea, select, [contenteditable], [contenteditable] *, td, th";

/** @param {AppFeelFlags} f */
function buildCss(f) {
  /** @type {string[]} */
  const css = [];
  css.push("html{-webkit-text-size-adjust:100%;text-size-adjust:100%}");
  if (f.noOverscroll) css.push("html,body{overscroll-behavior:none!important}");
  // overflow-x on <html> moves to the viewport; clip on <body> does not make
  // it a scroll container, so the site's sticky header keeps working
  if (f.noHorizontalDrag) css.push("html{overflow-x:hidden!important}body{overflow-x:clip!important}");
  if (f.noTapHighlight) css.push("*{-webkit-tap-highlight-color:transparent}");
  if (f.fastTap) css.push("html,body{touch-action:manipulation!important}");
  if (f.noCallout) css.push(`${NO_CALLOUT}{-webkit-touch-callout:none}`);
  if (f.selectionOnlyWhereUseful) {
    css.push("html{-webkit-user-select:none;user-select:none}");
    css.push(`${SELECTABLE}{-webkit-user-select:text;user-select:text;-webkit-touch-callout:default}`);
  }
  if (f.noImageDrag) css.push("img,a{-webkit-user-drag:none;user-drag:none}");
  return css.join("\n");
}

/** @param {AppFeelFlags} f */
function buildScript(f) {
  // String.raw: Hermes ships bytecode, so page code is a plain string (see
  // src/injected.js). No backticks inside; the JSON values are inlined.
  return String.raw`(function () {
  var w = window;
  if (w.__nrAppFeel) return;
  try {
  var d = document;
  var F = ${JSON.stringify(f)};
  var VIEWPORT = ${JSON.stringify(VIEWPORT)};
  var CSS = ${JSON.stringify(buildCss(f))};
  w.__nrAppFeel = { flags: F };

  // ── styles: one <style> tag, put back if a navigation drops it ─────────
  function ensureStyle() {
    var root = d.head || d.documentElement;
    if (!root || d.getElementById("nr-app-feel")) return;
    var s = d.createElement("style");
    s.id = "nr-app-feel";
    s.textContent = CSS;
    root.appendChild(s);
  }

  // ── viewport: no pinch or double-tap zoom ───────────────────────────────
  function ensureViewport() {
    if (!F.viewportLock || !d.head) return;
    // the website's framework can stream a second viewport tag in later, and
    // the browser obeys the last one: lock every one of them
    var all = d.querySelectorAll('meta[name="viewport"]');
    if (!all.length) {
      var m = d.createElement("meta");
      m.setAttribute("name", "viewport");
      d.head.appendChild(m);
      all = [m];
    }
    for (var i = 0; i < all.length; i++) {
      if (all[i].getAttribute("content") !== VIEWPORT) all[i].setAttribute("content", VIEWPORT);
    }
  }

  // The head is parsed after this script runs, and the website's router may
  // rewrite <meta name="viewport"> on navigation: re-apply each time. Only
  // <html> (for the head arriving) and <head> are watched, never the body,
  // so page renders cost nothing.
  var headWatched = false;
  function watchHead() {
    if (headWatched || !d.head || typeof MutationObserver === "undefined") return;
    headWatched = true;
    new MutationObserver(apply).observe(d.head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["content"],
    });
  }
  function apply() {
    ensureStyle();
    ensureViewport();
    watchHead();
  }
  w.__nrAppFeel.apply = apply;
  apply();
  try {
    if (!d.head) new MutationObserver(apply).observe(d.documentElement || d, { childList: true, subtree: !d.documentElement });
  } catch (e) {
    /* no MutationObserver: DOMContentLoaded below still applies once */
  }
  d.addEventListener("DOMContentLoaded", apply);

  if (F.viewportLock) {
    // iOS ignores user-scalable=no for pinch; cancel the gesture itself
    ["gesturestart", "gesturechange"].forEach(function (t) {
      d.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
    });
  }

  // ── long press: no menu on links, buttons and images ───────────────────
  function inField(el) {
    return !!(el && el.closest && el.closest("input, textarea, select, [contenteditable]"));
  }
  if (F.noCallout) {
    d.addEventListener("contextmenu", function (e) {
      var t = e.target;
      if (!t || !t.closest || inField(t)) return;
      if (t.closest(${JSON.stringify(NO_CALLOUT)})) e.preventDefault();
    }, true);
  }
  if (F.noImageDrag) {
    d.addEventListener("dragstart", function (e) {
      if (!inField(e.target)) e.preventDefault();
    }, true);
  }

  // ── keyboard: keep the focused field visible ────────────────────────────
  if (F.keyboardScroll) {
    var focused = null;
    function reveal() {
      var el = focused;
      if (!el || d.activeElement !== el || !el.getBoundingClientRect) return;
      var vv = w.visualViewport;
      var top = vv ? vv.offsetTop : 0;
      var bottom = top + (vv ? vv.height : w.innerHeight);
      var r = el.getBoundingClientRect();
      if (r.top < top + 8 || r.bottom > bottom - 8) {
        try {
          el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        } catch (e) {
          el.scrollIntoView(false);
        }
      }
    }
    d.addEventListener("focusin", function (e) {
      var t = e.target;
      if (!t || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || "") && !t.isContentEditable) return;
      focused = t;
      // the keyboard animates in: check after it has settled
      setTimeout(reveal, 120);
      setTimeout(reveal, 450);
    });
    d.addEventListener("focusout", function () { focused = null; });
    if (w.visualViewport) w.visualViewport.addEventListener("resize", function () { setTimeout(reveal, 30); });
    w.addEventListener("resize", function () { setTimeout(reveal, 30); });
  }
  } catch (e) {
    /* a tweak failing must never break the website */
  }
})();
true;`;
}

/**
 * The page script for the given flags (all on by default).
 * @param {Partial<AppFeelFlags>} [overrides]
 */
function buildAppFeelScript(overrides) {
  return buildScript({ ...APP_FEEL, ...(overrides || {}) });
}

module.exports = { APP_FEEL, VIEWPORT, buildAppFeelScript, buildAppFeelCss: buildCss };
