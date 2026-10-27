// @ts-check
// Runs the app-feel script in a small fake DOM: styles, viewport lock,
// long-press handling and the per-tweak flags.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import appFeel from "../src/appFeel.js";
import injected from "../src/injected.js";

const { APP_FEEL, VIEWPORT, buildAppFeelScript, buildAppFeelCss } = appFeel;

class El {
  /** @param {string} tag */
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    /** @type {El[]} */ this.children = [];
    /** @type {Record<string, string>} */ this.attrs = {};
    this.id = "";
    this.textContent = "";
    /** @type {El | null} */ this.parent = null;
    this.isContentEditable = false;
  }
  /** @param {El} c */
  appendChild(c) {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  /** @param {string} k @param {string} v */
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  /** @param {string} k */
  getAttribute(k) {
    return k in this.attrs ? this.attrs[k] : null;
  }
  /** Minimal closest(): matches a comma list of tag names / [role=x]. @param {string} sel */
  closest(sel) {
    const parts = sel.split(",").map((s) => s.trim());
    /** @type {El | null} */ let el = this;
    while (el) {
      const node = el;
      if (
        parts.some((p) => {
          const role = /^\[role=(\w+)\]$/.exec(p);
          if (role) return node.attrs.role === role[1];
          if (p === "[contenteditable]") return "contenteditable" in node.attrs;
          return node.tagName === p.toUpperCase();
        })
      )
        return node;
      el = el.parent;
    }
    return null;
  }
}

/** @param {{ viewport?: string, head?: boolean }} [opts] */
function page(opts = {}) {
  const html = new El("html");
  const head = new El("head");
  let hasHead = opts.head !== false;
  if (hasHead) html.appendChild(head);
  if (opts.viewport !== undefined) {
    const m = new El("meta");
    m.setAttribute("name", "viewport");
    m.setAttribute("content", opts.viewport);
    head.appendChild(m);
  }
  /** @type {Record<string, Function[]>} */ const listeners = {};
  /** @param {El} root @param {(e: El) => boolean} pred @returns {El | null} */
  const find = (root, pred) => {
    for (const c of root.children) {
      if (pred(c)) return c;
      const hit = find(c, pred);
      if (hit) return hit;
    }
    return null;
  };
  /** @param {El} root @param {(e: El) => boolean} pred @returns {El[]} */
  const findAll = (root, pred) => root.children.flatMap((c) => [...(pred(c) ? [c] : []), ...findAll(c, pred)]);
  const document = {
    documentElement: html,
    get head() {
      return hasHead ? head : null;
    },
    activeElement: null,
    createElement: (/** @type {string} */ t) => new El(t),
    getElementById: (/** @type {string} */ id) => find(html, (e) => e.id === id),
    querySelectorAll: (/** @type {string} */ sel) => (sel === 'meta[name="viewport"]' ? findAll(html, (e) => e.tagName === "META" && e.attrs.name === "viewport") : []),
    addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => {
      (listeners[t] ||= []).push(fn);
    },
  };
  const window = { innerHeight: 800, addEventListener() {} };
  const sandbox = { window, document, setTimeout, MutationObserver: class { observe() {} } };
  vm.createContext(sandbox);
  /** @param {string} type @param {any} target */
  const fire = (type, target) => {
    let prevented = false;
    for (const fn of listeners[type] || []) fn({ type, target, preventDefault: () => (prevented = true) });
    return prevented;
  };
  const attachHead = () => {
    hasHead = true;
    html.appendChild(head);
  };
  return { sandbox, html, head, listeners, fire, find, findAll, attachHead };
}

/** @param {ReturnType<typeof page>} p @param {string} code */
const run = (p, code) => vm.runInContext(code, p.sandbox);

test("every tweak is on by default and each has its own flag", () => {
  assert.deepEqual(Object.keys(APP_FEEL).sort(), [
    "fastTap",
    "keyboardScroll",
    "noCallout",
    "noHorizontalDrag",
    "noImageDrag",
    "noOverscroll",
    "noTapHighlight",
    "selectionOnlyWhereUseful",
    "viewportLock",
  ]);
  assert.ok(Object.values(APP_FEEL).every((v) => v === true));
  assert.ok(Object.isFrozen(APP_FEEL));
});

test("the CSS has one rule set per flag, and only for flags that are on", () => {
  const all = buildAppFeelCss({ ...APP_FEEL });
  assert.match(all, /overscroll-behavior:none/);
  assert.match(all, /html\{overflow-x:hidden!important\}body\{overflow-x:clip!important\}/);
  assert.match(all, /-webkit-tap-highlight-color:transparent/);
  assert.match(all, /touch-action:manipulation/);
  assert.match(all, /-webkit-touch-callout:none/);
  assert.match(all, /html\{-webkit-user-select:none;user-select:none\}/);
  assert.match(all, /input, textarea, select, \[contenteditable\], \[contenteditable\] \*, td, th\{-webkit-user-select:text/);
  assert.match(all, /-webkit-user-drag:none/);

  const none = buildAppFeelCss({
    viewportLock: false,
    noOverscroll: false,
    noHorizontalDrag: false,
    noTapHighlight: false,
    fastTap: false,
    noCallout: false,
    selectionOnlyWhereUseful: false,
    noImageDrag: false,
    keyboardScroll: false,
  });
  assert.equal(none, "html{-webkit-text-size-adjust:100%;text-size-adjust:100%}");
});

test("the body never scrolls on its own (the sticky header keeps working)", () => {
  assert.doesNotMatch(buildAppFeelCss({ ...APP_FEEL }), /body\{[^}]*overflow-x:(hidden|auto|scroll)/);
});

test("the script parses, has no template backticks and runs once only", () => {
  const code = buildAppFeelScript();
  assert.doesNotThrow(() => new vm.Script(code));
  assert.ok(!code.includes("`"));
  const p = page({ viewport: "width=device-width, initial-scale=1" });
  run(p, code);
  run(p, code);
  assert.equal(p.head.children.filter((c) => c.tagName === "STYLE").length, 1);
});

test("viewport: the site's meta is rewritten to the locked one", () => {
  const p = page({ viewport: "width=device-width, initial-scale=1" });
  run(p, buildAppFeelScript());
  const meta = p.find(p.html, (e) => e.tagName === "META");
  assert.equal(meta?.getAttribute("content"), VIEWPORT);
  assert.match(VIEWPORT, /maximum-scale=1/);
  assert.match(VIEWPORT, /user-scalable=no/);
  assert.match(VIEWPORT, /viewport-fit=cover/);
});

test("viewport: every viewport tag is locked (the framework can stream in a second one)", () => {
  const p = page({ viewport: "width=device-width, initial-scale=1" });
  const late = new El("meta");
  late.setAttribute("name", "viewport");
  late.setAttribute("content", "width=device-width, initial-scale=1");
  p.head.appendChild(late);
  run(p, buildAppFeelScript());
  const metas = p.findAll(p.html, (e) => e.tagName === "META");
  assert.equal(metas.length, 2);
  assert.ok(metas.every((m) => m.getAttribute("content") === VIEWPORT));
});

test("viewport: added when the page has none", () => {
  const p = page();
  run(p, buildAppFeelScript());
  const meta = p.find(p.html, (e) => e.tagName === "META");
  assert.equal(meta?.getAttribute("content"), VIEWPORT);
});

test("viewport: left alone when the flag is off", () => {
  const p = page({ viewport: "width=device-width, initial-scale=1" });
  run(p, buildAppFeelScript({ viewportLock: false }));
  const meta = p.find(p.html, (e) => e.tagName === "META");
  assert.equal(meta?.getAttribute("content"), "width=device-width, initial-scale=1");
  assert.equal(p.listeners.gesturestart, undefined);
});

test("viewport: applied once the head arrives (script runs before the page is parsed)", () => {
  const p = page({ head: false });
  run(p, buildAppFeelScript());
  assert.equal(p.find(p.html, (e) => e.tagName === "META"), null);
  p.attachHead();
  for (const fn of p.listeners.DOMContentLoaded || []) fn();
  assert.equal(p.find(p.html, (e) => e.tagName === "META")?.getAttribute("content"), VIEWPORT);
  // before <head> existed the style went on <html>; it is never added twice
  const styles = [...p.html.children, ...p.head.children].filter((c) => c.tagName === "STYLE");
  assert.equal(styles.length, 1);
});

test("long press: no menu on links, buttons, images; inputs keep theirs (paste works)", () => {
  const p = page();
  run(p, buildAppFeelScript());
  const a = new El("a");
  const span = a.appendChild(new El("span"));
  const btn = new El("button");
  const img = new El("img");
  const input = new El("input");
  const para = new El("p");
  assert.equal(p.fire("contextmenu", span), true);
  assert.equal(p.fire("contextmenu", btn), true);
  assert.equal(p.fire("contextmenu", img), true);
  assert.equal(p.fire("contextmenu", input), false);
  assert.equal(p.fire("contextmenu", para), false);
});

test("long press: untouched when the flag is off", () => {
  const p = page();
  run(p, buildAppFeelScript({ noCallout: false }));
  assert.equal(p.fire("contextmenu", new El("a")), false);
});

test("dragging: blocked outside fields, allowed in them", () => {
  const p = page();
  run(p, buildAppFeelScript());
  assert.equal(p.fire("dragstart", new El("img")), true);
  assert.equal(p.fire("dragstart", new El("textarea")), false);
});

test("iOS pinch gestures are cancelled", () => {
  const p = page();
  run(p, buildAppFeelScript());
  assert.equal(p.fire("gesturestart", new El("div")), true);
  assert.equal(p.fire("gesturechange", new El("div")), true);
});

test("keyboard: focusing an input is watched; other elements are not", () => {
  const p = page();
  run(p, buildAppFeelScript());
  assert.equal((p.listeners.focusin || []).length, 1);
  assert.equal((p.listeners.focusout || []).length, 1);
  const off = page();
  run(off, buildAppFeelScript({ keyboardScroll: false }));
  assert.equal(off.listeners.focusin, undefined);
});

test("the injected bundle carries the app-feel script after the bridge", () => {
  const all = injected.buildInjectedScript();
  const bridge = all.indexOf("w.__nrApp = { version: 1 }");
  const feel = all.indexOf("w.__nrAppFeel = { flags: F }");
  assert.ok(bridge > -1 && feel > bridge);
  assert.doesNotThrow(() => new vm.Script(all));
  assert.match(injected.buildInjectedScript({ noCallout: false }), /"noCallout":false/);
});
