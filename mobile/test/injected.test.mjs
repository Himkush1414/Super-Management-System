// @ts-check
// Runs the page script in a fake browser to check what it does on the page.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import injected from "../src/injected.js";

/**
 * @param {{ path?: string, theme?: string|null, dialog?: boolean, focused?: string, bg?: string, menuOpen?: boolean,
 *   fetch?: (url: string, init: any) => Promise<any> }} [opts]
 */
function page(opts = {}) {
  /** @type {any[]} */ const posted = [];
  /** @type {Record<string, Function[]>} */ const docListeners = {};
  /** @type {Record<string, Function[]>} */ const winListeners = {};
  /** @type {string[]} */ const historyCalls = [];
  const style = { backgroundColor: opts.bg ?? "rgb(10, 10, 10)" };
  /** @type {any[]} */ const dispatched = [];
  /** @type {{ url: string, init: any }[]} */ const fetches = [];
  let menuClicks = 0;
  // the mobile menu's close button: in the page always, visible only when open
  const menuButton = { getClientRects: () => (opts.menuOpen ? [{}] : []), click: () => menuClicks++ };
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
  const history = {
    pushState: (/** @type {any} */ _s, /** @type {string} */ _t, /** @type {string} */ url) => historyCalls.push(`push ${url}`),
    replaceState: (/** @type {any} */ _s, /** @type {string} */ _t, /** @type {string} */ url) => historyCalls.push(`replace ${url}`),
  };
  const window = {
    ReactNativeWebView: { postMessage: (/** @type {string} */ s) => posted.push(JSON.parse(s)) },
    WebSocket: FakeWS,
    history,
    requestAnimationFrame: (/** @type {() => void} */ f) => f(),
    addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => (winListeners[t] ||= []).push(fn),
  };
  const sandbox = {
    window,
    HTMLAnchorElement: Anchor,
    location: {
      pathname: opts.path ?? "/dashboard/orders",
      search: "",
      origin: "https://site",
      href: `https://site${opts.path ?? "/dashboard/orders"}`,
      reload: () => reloads++,
    },
    history,
    URL,
    setTimeout,
    getComputedStyle: () => style,
    fetch: (/** @type {string} */ url, /** @type {any} */ init) => {
      fetches.push({ url, init });
      return opts.fetch ? opts.fetch(url, init) : Promise.reject(new Error("offline"));
    },
    FileReader: class {
      constructor() {
        /** @type {any} */ this.result = null;
        /** @type {any} */ this.onload = null;
        /** @type {any} */ this.onerror = null;
      }
      /** @param {{ type: string, base64: string }} b */
      readAsDataURL(b) {
        this.result = `data:${b.type};base64,${b.base64}`;
        setTimeout(() => this.onload && this.onload(), 0);
      }
    },
    KeyboardEvent: class {
      /** @param {string} type @param {any} init */
      constructor(type, init) {
        this.type = type;
        Object.assign(this, init);
      }
    },
    document: {
      documentElement,
      body: {},
      cookie: "",
      activeElement: opts.focused ? { tagName: opts.focused } : null,
      querySelector: (/** @type {string} */ sel) => {
        if (sel.includes('aria-label="Close menu"')) return menuButton;
        return opts.dialog ? {} : null;
      },
      addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => (docListeners[t] ||= []).push(fn),
      dispatchEvent: (/** @type {any} */ e) => {
        dispatched.push(e);
        return true;
      },
    },
    MutationObserver: class {
      /** @param {() => void} cb */
      constructor(cb) {
        observers.push(cb);
      }
      observe() {}
    },
    atob,
    setInterval: () => 0,
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
    /** @param {string} bg */
    setBg(bg) {
      style.backgroundColor = bg;
      observers.forEach((cb) => cb());
    },
    /** @param {string} type @param {any} [ev] @returns {any} the event, to check defaultPrevented */
    fire(type, ev = {}) {
      const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...ev };
      for (const fn of docListeners[type] || []) fn(e);
      return e;
    },
    /** @param {string} type @param {any} [ev] */
    fireWindow(type, ev = {}) {
      for (const fn of winListeners[type] || []) fn(ev);
    },
    history,
    historyCalls,
    dispatched,
    fetches,
    get menuClicks() {
      return menuClicks;
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

test("after the first paint: the page's background colour, then 'painted'", () => {
  const p = page({ bg: "rgb(245, 245, 246)" });
  p.fire("DOMContentLoaded");
  const tail = p.posted.filter((m) => m.type === "bg" || m.type === "painted");
  assert.deepEqual(tail, [{ type: "bg", value: "rgb(245, 245, 246)" }, { type: "painted" }]);
});

test("a background change (theme toggle) is reported once", () => {
  const p = page();
  p.fire("DOMContentLoaded");
  p.setBg("rgb(245, 245, 246)");
  p.setBg("rgb(245, 245, 246)");
  assert.deepEqual(
    p.posted.filter((m) => m.type === "bg").map((m) => m.value),
    ["rgb(10, 10, 10)", "rgb(245, 245, 246)"],
  );
});

/** @param {{ href: string, download?: boolean, target?: string }} a */
const linkTarget = (a) => {
  const el = {
    href: a.href,
    target: a.target || "",
    hasAttribute: (/** @type {string} */ k) => k === "download" && !!a.download,
  };
  return { closest: () => el };
};

test("a tap on a same-site page link starts the progress bar; the address change ends it", () => {
  const p = page({ path: "/dashboard/orders" });
  p.fire("click", { target: linkTarget({ href: "https://site/dashboard/activity" }), button: 0 });
  assert.deepEqual(p.posted.at(-1), { type: "nav", state: "start" });
  p.history.pushState(null, "", "/dashboard/activity");
  assert.deepEqual(p.historyCalls, ["push /dashboard/activity"]);
  assert.ok(p.posted.some((m) => m.type === "nav" && m.state === "end"));
  const ends = p.posted.filter((m) => m.type === "nav" && m.state === "end").length;
  p.fireWindow("popstate");
  assert.equal(p.posted.filter((m) => m.type === "nav" && m.state === "end").length, ends + 1);
});

test("downloads, other sites, new tabs and same-page links don't start the bar", () => {
  const p = page({ path: "/dashboard/orders" });
  const before = p.posted.length;
  p.fire("click", { target: linkTarget({ href: "https://site/dashboard/orders/csv", download: true }), button: 0 });
  p.fire("click", { target: linkTarget({ href: "https://elsewhere.example/" }), button: 0 });
  p.fire("click", { target: linkTarget({ href: "https://site/dashboard/activity", target: "_blank" }), button: 0 });
  p.fire("click", { target: linkTarget({ href: "https://site/dashboard/orders#top" }), button: 0 });
  p.fire("click", { target: { closest: () => null }, button: 0 });
  assert.equal(p.posted.slice(before).filter((m) => m.type === "nav").length, 0);
});

test("back: an open dialog closes the website's way (Escape)", () => {
  const p = page({ dialog: true });
  p.w.__nrBack();
  assert.equal(p.dispatched.length, 1);
  assert.equal(p.dispatched[0].type, "keydown");
  assert.equal(p.dispatched[0].key, "Escape");
  assert.equal(p.dispatched[0].bubbles, true);
  assert.deepEqual(p.posted.at(-1), { type: "back", handled: "dialog" });
});

test("back: the open mobile menu closes through its own button", () => {
  const p = page({ menuOpen: true });
  p.w.__nrBack();
  assert.equal(p.menuClicks, 1);
  assert.deepEqual(p.posted.at(-1), { type: "back", handled: "menu" });
});

test("back: nothing open → the app decides (history or exit)", () => {
  const p = page();
  p.w.__nrBack();
  assert.equal(p.menuClicks, 0);
  assert.equal(p.dispatched.length, 0);
  assert.deepEqual(p.posted.at(-1), { type: "back", handled: "" });
});

// ── downloads: caught in the page, fetched with the session, sent in pieces ──

/** a fetch Response stand-in @param {{ status?: number, type?: string, cd?: string, base64?: string }} r */
const response = (r) => ({
  ok: (r.status ?? 200) < 400,
  status: r.status ?? 200,
  headers: {
    get: (/** @type {string} */ k) =>
      ({ "content-type": r.type ?? "application/pdf", "content-disposition": r.cd ?? "" })[k.toLowerCase()] ?? null,
  },
  blob: () => Promise.resolve({ type: (r.type ?? "application/pdf").split(";")[0], base64: r.base64 ?? "JVBERi0=" }),
});
const settle = () => new Promise((r) => setTimeout(r, 20));

test("download link: no browser download; fetched in the page with the session cookie", async () => {
  const p = page({ fetch: () => Promise.resolve(response({ cd: 'attachment; filename="orders-2026-10-27.csv"', type: "text/csv; charset=utf-8", base64: "YSxiCjEsMgo=" })) });
  const e = p.fire("click", { target: linkTarget({ href: "https://site/dashboard/orders/csv", download: true }), button: 0 });
  assert.equal(e.defaultPrevented, true);
  // (plain copy: the init object comes from the page's realm)
  assert.deepEqual(JSON.parse(JSON.stringify(p.fetches)), [
    { url: "https://site/dashboard/orders/csv", init: { credentials: "include", cache: "no-store" } },
  ]);
  await settle();
  const msgs = p.posted.filter((m) => String(m.type).startsWith("file-"));
  assert.deepEqual(msgs.map((m) => m.type), ["file-start", "file-chunk", "file-end"]);
  assert.deepEqual(msgs[2], { type: "file-end", id: msgs[0].id, name: "orders-2026-10-27.csv", mime: "text/csv", chunks: 1 });
  assert.equal(msgs[1].data, "YSxiCjEsMgo=");
  // a file link never starts the page-switch bar
  assert.equal(p.posted.filter((m) => m.type === "nav").length, 0);
});

test("the website's file routes are caught even without a download attribute", () => {
  const p = page();
  for (const path of ["/dashboard/orders/pdf?period=month&at=2026-10-01", "/dashboard/orders/0b7c6a0e-1f0e-4c43-9a4e-3c2a1b0d9e8f/pdf"]) {
    const e = p.fire("click", { target: linkTarget({ href: `https://site${path}` }), button: 0 });
    assert.equal(e.defaultPrevented, true, path);
  }
  assert.equal(p.fetches.length, 2);
});

test("ordinary links and other sites' files are left to the browser", () => {
  const p = page();
  for (const href of ["https://site/dashboard/activity", "https://elsewhere.example/report.pdf"]) {
    const e = p.fire("click", { target: linkTarget({ href, download: href.endsWith(".pdf") }), button: 0 });
    assert.equal(e.defaultPrevented, false, href);
  }
  assert.equal(p.fetches.length, 0);
});

test("a big file goes over in 256 KB pieces, in order", async () => {
  const big = "A".repeat(256 * 1024 * 2 + 10);
  const p = page({ fetch: () => Promise.resolve(response({ cd: 'attachment; filename="all.pdf"', base64: big })) });
  p.w.__nrFetchFile("https://site/dashboard/orders/pdf?period=all");
  await settle();
  const chunks = p.posted.filter((m) => m.type === "file-chunk");
  assert.deepEqual(chunks.map((c) => [c.i, c.n]), [[0, 3], [1, 3], [2, 3]]);
  assert.equal(chunks.map((c) => c.data).join(""), big);
  assert.equal(p.posted.at(-1).chunks, 3);
});

test("signed out meanwhile (login page came back): a clear error, no file", async () => {
  const p = page({ fetch: () => Promise.resolve(response({ type: "text/html; charset=utf-8" })) });
  p.w.__nrFetchFile("https://site/dashboard/orders/csv");
  await settle();
  const err = p.posted.at(-1);
  assert.equal(err.type, "file-error");
  assert.equal(err.signedOut, true);
  assert.equal(p.posted.filter((m) => m.type === "file-chunk").length, 0);
});

test("a server error is reported, not saved", async () => {
  const p = page({ fetch: () => Promise.resolve(response({ status: 500 })) });
  p.w.__nrFetchFile("https://site/dashboard/orders/csv");
  await settle();
  assert.deepEqual(
    (({ type, message, signedOut }) => ({ type, message, signedOut }))(p.posted.at(-1)),
    { type: "file-error", message: "HTTP 500", signedOut: false },
  );
});

test("file names come from Content-Disposition, else the URL", () => {
  const p = page();
  const name = p.w.__nrApp.fileName;
  assert.equal(name('attachment; filename="NR Orders – Oct.pdf"', "x"), "NR Orders – Oct.pdf");
  assert.equal(name("attachment; filename*=UTF-8''NR%20Orders%20%E2%80%93%20Oct.pdf", "x"), "NR Orders – Oct.pdf");
  assert.equal(name("attachment; filename=plain.csv", "x"), "plain.csv");
  assert.equal(name("", "https://site/dashboard/orders/csv?x=1"), "csv");
});

// ── session bridge: cookies exactly as the website's @supabase/ssr writes them ──
import { createRequire } from "node:module";
const ssr = createRequire(import.meta.url)("../../node_modules/@supabase/ssr/dist/main/utils/index.js");

/** @param {Record<string, unknown>} claims */
const jwt = (claims) =>
  ["h", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");

/**
 * document.cookie for a session, chunked/encoded like @supabase/ssr does.
 * @param {Record<string, unknown>} session
 */
function ssrCookie(session, { key = "sb-ywzwzrzlittjiosskmcy-auth-token", base64 = true } = {}) {
  const value = base64 ? "base64-" + ssr.stringToBase64URL(JSON.stringify(session)) : JSON.stringify(session);
  return ssr
    .createChunks(key, value)
    .map((/** @type {{name: string, value: string}} */ c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join("; ");
}

/** @param {string} cookie */
function sessionPage(cookie) {
  /** @type {any[]} */ const posted = [];
  const doc = {
    cookie,
    documentElement: { getAttribute: () => null },
    activeElement: null,
    querySelector: () => null,
    addEventListener: () => {},
  };
  const sandbox = {
    window: { ReactNativeWebView: { postMessage: (/** @type {string} */ s) => posted.push(JSON.parse(s)) } },
    HTMLAnchorElement: class { click() {} },
    location: { pathname: "/dashboard/orders" },
    document: doc,
    MutationObserver: class { observe() {} },
    atob,
    setInterval: () => 0,
  };
  vm.createContext(sandbox);
  vm.runInContext(injected.buildInjectedScript(), sandbox);
  const w = /** @type {any} */ (sandbox.window);
  return { posted, doc, report: () => w.__nrApp.reportSession(), sessions: () => posted.filter((m) => m.type === "session") };
}

const USER = "d27e48dd-5418-4ec7-a2ff-97c6a6b2d147";

test("reads the signed-in user from the base64 @supabase/ssr cookie", () => {
  const at = jwt({ sub: USER, role: "authenticated", exp: 2000000000 });
  const p = sessionPage(`nr-theme=dark; ${ssrCookie({ access_token: at, refresh_token: "r-secret", expires_at: 2000000000, user: { id: USER } })}`);
  assert.deepEqual(p.sessions(), [{ type: "session", userId: USER, accessToken: at, expiresAt: 2000000000 }]);
  assert.doesNotMatch(JSON.stringify(p.posted), /r-secret|refresh/, "the refresh token never leaves the page");
});

test("reassembles a chunked cookie (.0, .1, …) with non-ASCII user data", () => {
  const at = jwt({ sub: USER, pad: "x".repeat(5000) });
  const cookie = ssrCookie({ access_token: at, refresh_token: "r", user: { id: USER, user_metadata: { full_name: "Rāj Kumār ✓" } } });
  assert.match(cookie, /auth-token\.1=/, "the fixture really is chunked");
  const p = sessionPage(`sb-ywzwzrzlittjiosskmcy-auth-token-code-verifier=abc; ${cookie}`);
  assert.equal(p.sessions()[0].userId, USER);
  assert.equal(p.sessions()[0].accessToken, at);
});

test("plain-JSON cookies (older encoding) work too", () => {
  const at = jwt({ sub: USER });
  const p = sessionPage(ssrCookie({ access_token: at, user: { id: USER } }, { base64: false }));
  assert.equal(p.sessions()[0].userId, USER);
});

test("no session cookie, or a broken one, reports signed out", () => {
  assert.deepEqual(sessionPage("nr-theme=light").sessions(), [{ type: "session", userId: null }]);
  assert.deepEqual(sessionPage("sb-x-auth-token=base64-%%%broken").sessions(), [{ type: "session", userId: null }]);
  assert.deepEqual(sessionPage(`sb-x-auth-token=${encodeURIComponent('{"access_token":"not-a-jwt"}')}`).sessions(), [
    { type: "session", userId: null },
  ]);
});

test("reports only on change: sign-in, token refresh, sign-out", () => {
  const p = sessionPage("");
  const a1 = jwt({ sub: USER, n: 1 });
  const a2 = jwt({ sub: USER, n: 2 });
  p.report();
  p.doc.cookie = ssrCookie({ access_token: a1, user: { id: USER } });
  p.report();
  p.report();
  p.doc.cookie = ssrCookie({ access_token: a2, user: { id: USER } });
  p.report();
  p.doc.cookie = "nr-theme=dark";
  p.report();
  assert.deepEqual(
    p.sessions().map((m) => m.accessToken ?? null),
    [null, a1, a2, null],
  );
});
