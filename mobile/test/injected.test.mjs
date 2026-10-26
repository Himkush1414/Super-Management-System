// @ts-check
// Runs the page script in a fake browser to check what it does on the page.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import injected from "../src/injected.js";

/** @param {{ path?: string, theme?: string|null, dialog?: boolean, focused?: string }} [opts] */
function page(opts = {}) {
  /** @type {any[]} */ const posted = [];
  /** @type {any[]} */ const sockets = [];
  let reloads = 0;
  const attrs = { "data-theme": opts.theme ?? null };
  /** @type {(() => void)[]} */ const observers = [];

  class FakeWS {
    /** @param {string} url @param {any} [protocols] */
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.readyState = 1;
      /** @type {any} */ this.onclose = null;
      /** @type {Record<string, Function[]>} */ this.listeners = {};
      this.closedWith = /** @type {any} */ (null);
      sockets.push(this);
    }
    /** @param {string} ev @param {Function} fn */
    addEventListener(ev, fn) {
      (this.listeners[ev] ||= []).push(fn);
    }
    /** @param {number} code @param {string} reason */
    close(code, reason) {
      this.readyState = 2;
      this.closedWith = { code, reason };
    }
  }
  class Anchor {
    constructor() {
      this.href = "";
      this.download = "";
      this.clicked = 0;
    }
    click() {
      this.clicked++;
    }
  }
  const documentElement = { getAttribute: (/** @type {string} */ k) => /** @type {any} */ (attrs)[k] };
  const window = {
    ReactNativeWebView: { postMessage: (/** @type {string} */ s) => posted.push(JSON.parse(s)) },
    WebSocket: FakeWS,
  };
  const sandbox = {
    window,
    HTMLAnchorElement: Anchor,
    location: { pathname: opts.path ?? "/dashboard/orders", reload: () => reloads++ },
    document: {
      documentElement,
      activeElement: opts.focused ? { tagName: opts.focused } : null,
      querySelector: () => (opts.dialog ? {} : null),
      addEventListener: () => {},
    },
    MutationObserver: class {
      /** @param {() => void} cb */
      constructor(cb) {
        observers.push(cb);
      }
      observe() {}
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(injected.buildInjectedScript(), sandbox);
  const w = /** @type {any} */ (sandbox.window);
  return {
    w,
    posted,
    sockets,
    Anchor,
    get reloads() {
      return reloads;
    },
    /** @param {string|null} t */
    setTheme(t) {
      attrs["data-theme"] = t;
      observers.forEach((cb) => cb());
    },
  };
}

test("the script is plain source text and evaluates to true", () => {
  const src = injected.buildInjectedScript();
  assert.match(src, /^\(function \(\) \{/);
  assert.match(src, /true;$/);
  assert.match(src, /\/realtime\/v1\/websocket/);
});

test("running it twice installs once", () => {
  const p = page();
  const first = p.w.WebSocket;
  vm.runInContext(injected.buildInjectedScript(), vm.createContext({ window: p.w }));
  assert.equal(p.w.WebSocket, first);
});

test("a blob: download fails loudly so the website deletes nothing", () => {
  const p = page();
  const a = new p.Anchor();
  a.href = "blob:https://site/123";
  a.download = "nr-archive-production1.pdf";
  assert.throws(() => a.click(), /not available in the app/);
  assert.equal(a.clicked, 0);
  assert.deepEqual(p.posted.at(-1), { type: "blob-download-blocked", name: "nr-archive-production1.pdf" });
});

test("ordinary link clicks still go through", () => {
  const p = page();
  const a = new p.Anchor();
  a.href = "https://site/dashboard/orders/csv";
  a.click();
  assert.equal(a.clicked, 1);
});

test("only Supabase realtime sockets are tracked, and resume reconnects them", () => {
  const p = page({ path: "/dashboard/orders/new" });
  const rt = new p.w.WebSocket("wss://abc.supabase.co/realtime/v1/websocket?apikey=x", ["phoenix"]);
  new p.w.WebSocket("wss://other.example/socket");
  /** @type {any} */ let closedEvent = null;
  rt.onclose = (/** @type {any} */ e) => (closedEvent = e);
  assert.deepEqual(rt.protocols, ["phoenix"]);

  p.w.__nrResume(60_000);
  assert.deepEqual(rt.closedWith, { code: 4001, reason: "app resume" });
  assert.equal(closedEvent.wasClean, false, "the realtime client must treat it as unclean so it reconnects");
  assert.equal(p.sockets[1].closedWith, null, "non-realtime sockets are left alone");
  assert.deepEqual(p.posted.at(-1), { type: "resumed", sockets: 1, reload: false });
  assert.equal(p.reloads, 0, "the punch-order form is never reloaded");
});

test("read-only pages reload after a long absence, not a short one", () => {
  const p = page({ path: "/dashboard/orders/5f0c0b2e-1111-2222-3333-444455556666" });
  p.w.__nrResume(5_000);
  assert.equal(p.reloads, 0);
  p.w.__nrResume(45_000);
  assert.equal(p.reloads, 1);
});

test("an open dialog or a focused field blocks the reload", () => {
  const withDialog = page({ path: "/dashboard/orders", dialog: true });
  withDialog.w.__nrResume(120_000);
  assert.equal(withDialog.reloads, 0);
  const typing = page({ path: "/dashboard/orders", focused: "INPUT" });
  typing.w.__nrResume(120_000);
  assert.equal(typing.reloads, 0);
});

test("theme changes are reported once per change", () => {
  const p = page({ theme: null });
  assert.deepEqual(p.posted.filter((m) => m.type === "theme"), [{ type: "theme", value: "dark" }]);
  p.setTheme("light");
  p.setTheme("light");
  p.setTheme(null);
  assert.deepEqual(
    p.posted.filter((m) => m.type === "theme").map((m) => m.value),
    ["dark", "light", "dark"],
  );
});
