// @ts-check
// Runs the loading watchdog in a fake page with a fake clock: a tab switch
// that lands, one stuck on the skeleton, one that never starts, and what
// happens after the phone wakes up.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import watchdog from "../src/watchdog.js";

const { STALL_MS, MAX_MS, SKELETON, buildWatchdogScript } = watchdog;
const ORIGIN = "https://site";

/** @param {{ path?: string, readyState?: string, fetch?: (url: string, init: any) => Promise<any> }} [opts] */
function page(opts = {}) {
  let clock = 1_000_000;
  /** @type {Map<number, { fn: () => void, at: number }>} */ const timers = new Map();
  let nextId = 0;
  /** @type {any[]} */ const posted = [];
  /** @type {Record<string, Function[]>} */ const docListeners = {};
  /** @type {Record<string, Function[]>} */ const winListeners = {};
  /** @type {{ url: string, init: any }[]} */ const fetches = [];
  /** @type {(() => void) | null} */ let observer = null;
  let skeleton = false;
  const location = {
    origin: ORIGIN,
    pathname: opts.path ?? "/dashboard/orders",
    search: "",
    get href() {
      return ORIGIN + this.pathname + this.search;
    },
  };
  const go = (/** @type {string} */ url) => {
    const u = new URL(url, ORIGIN);
    location.pathname = u.pathname;
    location.search = u.search;
  };
  const history = { pushState: (/** @type {any} */ _s, /** @type {string} */ _t, /** @type {string} */ url) => go(url) };
  const document = {
    readyState: opts.readyState ?? "complete",
    querySelector: (/** @type {string} */ sel) => (sel === SKELETON && skeleton ? {} : null),
    addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => (docListeners[t] ||= []).push(fn),
  };
  const window = {
    ReactNativeWebView: { postMessage: (/** @type {string} */ s) => posted.push(JSON.parse(s)) },
    setTimeout: (/** @type {() => void} */ fn, /** @type {number} */ ms) => {
      timers.set(++nextId, { fn, at: clock + ms });
      return nextId;
    },
    clearTimeout: (/** @type {number} */ id) => timers.delete(id),
    MutationObserver: class {
      /** @param {() => void} cb */
      constructor(cb) {
        observer = cb;
      }
      observe() {}
    },
    history,
    navigator: { userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/140.0 Mobile NRManagement/1.0 (android)" },
    addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => (winListeners[t] ||= []).push(fn),
    // the app bridge's rule (src/injected.js): same-site, another page
    __nrApp: {
      isPageLink: (/** @type {{ href: string }} */ a) => {
        const u = new URL(a.href, location.href);
        return u.origin === ORIGIN && u.pathname + u.search !== location.pathname + location.search;
      },
    },
  };
  const sandbox = {
    window,
    document,
    location,
    URL,
    AbortController,
    Date: { now: () => clock },
    fetch: (/** @type {string} */ url, /** @type {any} */ init) => {
      fetches.push({ url, init });
      return opts.fetch ? opts.fetch(url, init) : Promise.reject(new Error("offline"));
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(buildWatchdogScript(), sandbox);
  const w = /** @type {any} */ (window);

  return {
    w,
    posted,
    fetches,
    /** posted messages of one type */
    of: (/** @type {string} */ type) => posted.filter((m) => m.type === type),
    /** the clock moves on; due timers run in order */
    advance(/** @type {number} */ ms) {
      const end = clock + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        clock = due[1].at;
        due[1].fn();
      }
      clock = end;
    },
    /** the page's DOM changed (a render, the skeleton coming or going) */
    change() {
      observer?.();
    },
    skeleton(/** @type {boolean} */ on) {
      skeleton = on;
      observer?.();
    },
    /** the document finished parsing */
    parsed() {
      document.readyState = "interactive";
      for (const fn of docListeners.DOMContentLoaded || []) fn({});
    },
    tap(/** @type {string} */ href) {
      const a = { href: new URL(href, ORIGIN).href };
      for (const fn of docListeners.click || []) fn({ target: { closest: () => a }, button: 0 });
    },
    /** the website's router moving to a new address */
    push(/** @type {string} */ url) {
      w.history.pushState(null, "", url);
    },
    back(/** @type {string} */ url) {
      go(url);
      for (const fn of winListeners.popstate || []) fn({});
    },
    pending: () => timers.size,
  };
}

/** a page whose own load is over, ready for tab switches */
function loaded(/** @type {Parameters<typeof page>[0]} */ opts = {}) {
  const p = page({ readyState: "loading", ...opts });
  p.parsed();
  p.posted.length = 0;
  return p;
}

test("the page's own load is watched from its first byte until it is on screen", () => {
  const p = page({ readyState: "loading" });
  assert.deepEqual(p.posted[0], { type: "nav", state: "start", kind: "load" });
  p.advance(300);
  p.change(); // the parser adding the page
  assert.equal(p.of("nav-log").length, 0, "not done while still parsing");
  p.advance(200);
  p.parsed();
  assert.deepEqual(p.of("nav-log"), [{ type: "nav-log", kind: "load", path: "/dashboard/orders", ms: 500, result: "ok" }]);
  assert.match(p.of("env")[0].ua, /Chrome\/140/);
  assert.equal(p.pending(), 0, "no timer left running");
});

test("a tab switch: skeleton first, then the page → ok, with its real duration", () => {
  const p = loaded();
  p.tap("/dashboard/activity");
  assert.deepEqual(p.posted.at(-1), { type: "nav", state: "start", kind: "click" });
  // the router commits the skeleton and the new address together
  p.push("/dashboard/activity");
  p.skeleton(true);
  p.advance(1200);
  assert.equal(p.of("nav-log").length, 0, "still on the skeleton");
  p.skeleton(false); // the page replaces the skeleton
  assert.deepEqual(p.of("nav-log"), [{ type: "nav-log", kind: "click", path: "/dashboard/activity", ms: 1200, result: "ok" }]);
  assert.deepEqual(p.of("nav").at(-1), { type: "nav", state: "end", kind: "click" });
  assert.equal(p.of("nav-stuck").length, 0);
});

test("stuck on the skeleton: reported once after STALL_MS without change, never again", () => {
  const p = loaded();
  p.tap("/dashboard/activity");
  p.push("/dashboard/activity");
  p.skeleton(true);
  p.advance(STALL_MS - 600);
  assert.equal(p.of("nav-stuck").length, 0, "not before STALL_MS");
  p.advance(1000);
  const stuck = p.of("nav-stuck");
  assert.equal(stuck.length, 1);
  assert.equal(stuck[0].kind, "click");
  assert.equal(stuck[0].href, `${ORIGIN}/dashboard/activity`);
  assert.equal(stuck[0].skeleton, true);
  assert.ok(stuck[0].ms >= STALL_MS && stuck[0].ms < STALL_MS + 1000, `ms ${stuck[0].ms}`);
  assert.deepEqual(p.of("nav").at(-1), { type: "nav", state: "end", kind: "click" });
  // the page decides nothing more: the app retries or shows its screen
  p.advance(120_000);
  assert.equal(p.of("nav-stuck").length, 1);
  assert.equal(p.pending(), 0);
});

test("a skeleton still on screen after STALL_MS is stuck, even while the header keeps changing", () => {
  const p = loaded();
  p.tap("/dashboard/activity");
  p.push("/dashboard/activity");
  p.skeleton(true);
  for (let t = 0; t < STALL_MS - 1000; t += 1000) {
    p.advance(1000);
    p.change(); // e.g. the header's live counter or a running timer
  }
  assert.equal(p.of("nav-stuck").length, 0, "not before STALL_MS");
  p.advance(1000);
  p.change();
  p.advance(600);
  const stuck = p.of("nav-stuck");
  assert.equal(stuck.length, 1);
  assert.equal(stuck[0].skeleton, true);
  assert.match(stuck[0].reason, /skeleton/);
  assert.ok(stuck[0].ms >= STALL_MS && stuck[0].ms < STALL_MS + 1000, `ms ${stuck[0].ms}`);
});

test("a page that keeps changing but never finishes is stuck after MAX_MS", () => {
  const p = loaded();
  p.tap("/dashboard/activity");
  // the address never moves and no skeleton comes, but the page keeps changing
  for (let t = 0; t < MAX_MS; t += 2000) {
    p.advance(2000);
    p.change(); // e.g. the header's live counter
  }
  p.advance(1000);
  const stuck = p.of("nav-stuck");
  assert.equal(stuck.length, 1);
  assert.match(stuck[0].reason, /not finished/);
});

test("a tap that never gets going (nothing moves, no skeleton) is retried at the tapped address", () => {
  const p = loaded();
  p.tap("/dashboard/settings");
  p.advance(STALL_MS + 500);
  const stuck = p.of("nav-stuck");
  assert.equal(stuck.length, 1);
  assert.equal(stuck[0].href, `${ORIGIN}/dashboard/settings`, "the link, not the page still showing");
  assert.equal(stuck[0].skeleton, false);
});

test("a change before the address moves (the menu closing) doesn't count as done", () => {
  const p = loaded();
  p.tap("/dashboard/activity");
  p.change(); // the mobile menu animating away, still on the old page
  p.advance(400);
  assert.equal(p.of("nav-log").length, 0);
  p.push("/dashboard/activity");
  p.change();
  assert.equal(p.of("nav-log")[0].result, "ok");
});

test("a second tap before the first finished replaces it (no false stuck)", () => {
  const p = loaded();
  p.tap("/dashboard/activity");
  p.advance(500);
  p.tap("/dashboard/settings");
  assert.deepEqual(p.of("nav-log")[0], { type: "nav-log", kind: "click", path: "/dashboard/activity", ms: 500, result: "replaced" });
  p.push("/dashboard/settings");
  p.change();
  assert.equal(p.of("nav-log")[1].result, "ok");
  assert.equal(p.of("nav-stuck").length, 0);
});

test("the router moving without a tap (after a form) and back/forward are watched too", () => {
  const p = loaded();
  p.push("/dashboard/orders/0b7c6a0e-1f0e-4c43-9a4e-3c2a1b0d9e8f");
  assert.deepEqual(p.posted.at(-1), { type: "nav", state: "start", kind: "push" });
  p.change();
  assert.deepEqual(p.of("nav-log")[0], { type: "nav-log", kind: "push", path: "/dashboard/orders/0b7c6a0e-1f0e-4c43-9a4e-3c2a1b0d9e8f", ms: 0, result: "ok" });
  p.back("/dashboard/orders");
  assert.deepEqual(p.posted.at(-1), { type: "nav", state: "start", kind: "pop" });
  p.advance(80);
  p.change();
  assert.equal(p.of("nav-log")[1].kind, "pop");
  assert.equal(p.of("nav-log")[1].result, "ok");
});

test("query strings never leave the page in a report", () => {
  const p = loaded();
  p.tap("/dashboard/activity?account=0b7c6a0e");
  p.push("/dashboard/activity?account=0b7c6a0e");
  p.change();
  assert.equal(p.of("nav-log")[0].path, "/dashboard/activity");
});

test("back from the background: a page switch still waiting is reported at once", () => {
  const p = loaded();
  assert.equal(p.w.__nrWatch.resumed(60_000), false, "nothing waiting: nothing to do");
  p.tap("/dashboard/activity");
  p.push("/dashboard/activity");
  p.skeleton(true);
  assert.equal(p.w.__nrWatch.resumed(60_000), true);
  const stuck = p.of("nav-stuck");
  assert.equal(stuck.length, 1);
  assert.match(stuck[0].reason, /background/);
  assert.equal(p.w.__nrWatch.current(), null);
});

test("back from the background: a page switch that did land is just logged", () => {
  const p = loaded();
  p.tap("/dashboard/activity");
  p.push("/dashboard/activity");
  p.skeleton(true);
  p.skeleton(false);
  assert.equal(p.w.__nrWatch.resumed(60_000), false);
  assert.equal(p.of("nav-stuck").length, 0);
});

test("warm-up: the health check through the WebView's own connection, no cookies, not cached", async () => {
  const p = loaded({ fetch: () => Promise.resolve({ ok: true, status: 200 }) });
  p.w.__nrWatch.warm();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(p.fetches[0].url, `${ORIGIN}/api/health`);
  assert.equal(p.fetches[0].init.credentials, "omit");
  assert.equal(p.fetches[0].init.cache, "no-store");
  assert.deepEqual(p.of("warmup")[0], { type: "warmup", where: "page", ms: 0, ok: true, status: 200 });
});

test("warm-up failing is reported, not thrown", async () => {
  const p = loaded();
  p.w.__nrWatch.warm();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(p.of("warmup")[0].ok, false);
});

test("outside a browser (no window timers) it does nothing", () => {
  const posted = /** @type {any[]} */ ([]);
  const window = { ReactNativeWebView: { postMessage: (/** @type {string} */ s) => posted.push(s) } };
  vm.runInContext(buildWatchdogScript(), vm.createContext({ window }));
  assert.equal(posted.length, 0);
});
