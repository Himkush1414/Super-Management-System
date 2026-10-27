// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import loading from "../src/loading.js";

const { RETRY_WINDOW_MS, LOG_MAX, onStuck, retryHow, pathOnly, addEntry, parseLog, formatReport } = loading;
const A = "https://site/dashboard/activity";

test("a retry of the page already showing is a native reload; a page that never left loads its link", () => {
  // the router already moved to the tab (push, back/forward, a tap that arrived) or a full load of it
  assert.equal(retryHow(A, A), "reload");
  assert.equal(retryHow(A, `${A}#top`), "reload", "a #fragment is the same page");
  // never got going: the WebView is still on the old page, so load the target
  assert.equal(retryHow(A, "https://site/dashboard/orders"), "assign");
  // the address is unknown: load the target
  assert.equal(retryHow(A, ""), "assign");
});

test("a stuck page is retried once, then the error screen (no loop)", () => {
  const first = onStuck(null, A, 1000);
  assert.equal(first.action, "retry");
  const again = onStuck(first.mark, `${A}#x`, 1000 + 9000);
  assert.equal(again.action, "error", "the same page, stuck again right after its retry");
  // and it stays an error until the window has passed
  assert.equal(onStuck(again.mark, A, 1000 + RETRY_WINDOW_MS - 1).action, "error");
});

test("a different page, or the same one much later, gets its own retry", () => {
  const first = onStuck(null, A, 1000);
  assert.equal(onStuck(first.mark, "https://site/dashboard/settings", 2000).action, "retry");
  assert.equal(onStuck(first.mark, A, 1000 + RETRY_WINDOW_MS).action, "retry");
});

test("the log keeps the newest 50, newest first, paths without query strings", () => {
  /** @type {any[]} */
  let log = [];
  for (let i = 0; i < LOG_MAX + 7; i++) {
    log = addEntry(log, { at: i, kind: "click", path: `/dashboard/orders?q=secret${i}`, ms: i * 10.4, result: "ok" });
  }
  assert.equal(log.length, LOG_MAX);
  assert.equal(log[0].at, LOG_MAX + 6);
  assert.equal(log[0].path, "/dashboard/orders");
  assert.equal(log[0].ms, Math.round((LOG_MAX + 6) * 10.4));
  assert.equal(JSON.stringify(log).includes("secret"), false);
});

test("pathOnly drops the query and fragment", () => {
  assert.equal(pathOnly("https://site/dashboard/orders/abc?x=1#y"), "/dashboard/orders/abc");
  assert.equal(pathOnly("not a url?x"), "not a url");
});

test("a stored log that is damaged is read back as far as it makes sense", () => {
  assert.deepEqual(parseLog(null), []);
  assert.deepEqual(parseLog({}), []);
  const log = parseLog([{ at: 2, kind: "click", path: "/a", ms: 5, result: "ok" }, "junk", { at: "x" }, { at: 1, kind: "load", path: "/b", ms: null, result: "retried", note: "n" }]);
  assert.deepEqual(log.map((e) => e.path), ["/a", "/b"], "order kept, junk dropped");
  assert.equal(log[1].ms, null);
});

test("the shared report: facts, then one line per navigation", () => {
  const log = addEntry([], { at: Date.UTC(2026, 9, 27, 6, 30, 5), kind: "click", path: "/dashboard/activity", ms: 1234, result: "ok" });
  const text = formatReport(log, [["App", "NR Management 1.0.0 (5)"]]);
  assert.match(text, /App: NR Management 1\.0\.0 \(5\)/);
  assert.match(text, /Last 1 navigations/);
  assert.match(text, /click\s+1234 ms\s+ok\s+\/dashboard\/activity/);
});
