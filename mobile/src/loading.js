// @ts-check
// The app's side of the loading watchdog (the page side is src/watchdog.js):
// what to do with a navigation that got stuck, and the list of recent
// navigations the hidden Diagnostics screen shows. Pure functions (no React
// Native imports) so they run under `node --test`.

/** One automatic retry per address within this window; after that, the error screen. */
const RETRY_WINDOW_MS = 60000;
/** Navigations kept for the Diagnostics screen. */
const LOG_MAX = 50;

/**
 * @typedef {{ href: string, at: number }} RetryMark
 * @typedef {{
 *   at: number,
 *   kind: string,
 *   path: string,
 *   ms: number | null,
 *   result: string,
 *   note?: string,
 * }} LogEntry
 */

/** Server errors retry by themselves after these waits, then wait for Retry. */
const SERVER_RETRY_MS = [10000, 20000, 40000];

/**
 * What the app knows about the page under its error screen: whether its
 * load failed (so Retry loads it again instead of only waking it), and how
 * many automatic retries of a server error have run.
 *
 * Android reports a main-page server error (onHttpError) and then finishes
 * that load (onLoad) like any other, so a finished load only counts as
 * working when no server error came with it. The automatic retries add up
 * across the retries themselves and start again only after a load that
 * worked, or when the user taps Retry.
 */
function createLoadState() {
  let failed = false;
  let httpError = false;
  let serverRetries = 0;
  return {
    /** A full load was asked for (start, link, reload, retry). */
    started() {
      httpError = false;
    },
    /** The main page answered with a server error. */
    serverError() {
      httpError = true;
      failed = true;
    },
    /** No network, DNS, TLS, or a stuck load that was stopped. */
    loadError() {
      failed = true;
    },
    /** onLoad: the WebView finished a load. */
    finished() {
      failed = httpError;
      if (!httpError) serverRetries = 0;
    },
    get failed() {
      return failed;
    },
    /** The wait before the next automatic retry of a server error, or null: wait for Retry. */
    nextServerRetry() {
      return serverRetries < SERVER_RETRY_MS.length ? SERVER_RETRY_MS[serverRetries] : null;
    },
    serverRetried() {
      serverRetries++;
    },
    /** The user tapped Retry: a new round of automatic retries. */
    retryTapped() {
      serverRetries = 0;
    },
  };
}

/** The address without its #fragment: the same page for retry purposes. */
function pageKey(/** @type {string} */ href) {
  return String(href).split("#")[0];
}

/**
 * A navigation got stuck at `href`. Retry it once (a fresh load of that
 * address); if that address was already retried a moment ago, stop and
 * show the error screen, so the app never loops on a page that can't load.
 *
 * @param {RetryMark | null} last  the previous automatic retry
 * @param {string} href
 * @param {number} now
 * @returns {{ action: "retry" | "error", mark: RetryMark | null }}
 */
function onStuck(last, href, now) {
  const key = pageKey(href);
  if (last && last.href === key && now - last.at < RETRY_WINDOW_MS) return { action: "error", mark: last };
  return { action: "retry", mark: { href: key, at: now } };
}

/**
 * How to retry a stuck page. When the WebView already shows the address
 * to retry (the router moved there, back/forward, a full load of it), the
 * WebView's own reload. A load started from page script (location.assign)
 * passes through onShouldStartLoadWithRequest, and on the emulator most
 * retries started that way were dropped without any error; a native
 * reload doesn't pass through it. Only a page that never left the old
 * address (a tap that never got going) still needs its link loaded.
 *
 * @param {string} href     the address to retry
 * @param {string} current  the address the WebView is showing
 * @returns {"reload" | "assign"}
 */
function retryHow(href, current) {
  return current && pageKey(current) === pageKey(href) ? "reload" : "assign";
}

/**
 * The path of an address, never its query string (search terms and
 * filters stay out of the log).
 * @param {string} href
 */
function pathOnly(href) {
  try {
    return new URL(href).pathname;
  } catch {
    return String(href).split(/[?#]/)[0];
  }
}

/**
 * Add an entry to the front of the log, keeping the newest LOG_MAX.
 * @param {LogEntry[]} log
 * @param {LogEntry} entry
 * @returns {LogEntry[]}
 */
function addEntry(log, entry) {
  const clean = {
    at: Number(entry.at) || 0,
    kind: String(entry.kind || "").slice(0, 16),
    path: String(entry.path || "").split(/[?#]/)[0].slice(0, 120),
    ms: typeof entry.ms === "number" && isFinite(entry.ms) ? Math.max(0, Math.round(entry.ms)) : null,
    result: String(entry.result || "").slice(0, 24),
    ...(entry.note ? { note: String(entry.note).slice(0, 120) } : {}),
  };
  return [clean, ...log].slice(0, LOG_MAX);
}

/**
 * A stored log read back from disk: anything malformed is dropped.
 * @param {unknown} raw
 * @returns {LogEntry[]}
 */
function parseLog(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {LogEntry[]} */
  let log = [];
  for (const e of raw.slice(0, LOG_MAX).reverse()) {
    if (e && typeof e === "object" && typeof e.at === "number") log = addEntry(log, /** @type {LogEntry} */ (e));
  }
  return log;
}

/** @param {number} at */
function clock(at) {
  const d = new Date(at);
  const p = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * The log as plain text, newest first, for the Share button.
 * @param {LogEntry[]} log
 * @param {[string, string][]} about  app and WebView facts, label/value
 */
function formatReport(log, about) {
  const lines = ["NR Management diagnostics", ""];
  for (const [k, v] of about) lines.push(`${k}: ${v}`);
  lines.push("", `Last ${log.length} navigations (newest first):`);
  for (const e of log) {
    const ms = e.ms === null ? "-" : `${e.ms} ms`;
    lines.push(`${clock(e.at)}  ${e.kind.padEnd(7)} ${ms.padStart(9)}  ${e.result.padEnd(8)} ${e.path}${e.note ? `  (${e.note})` : ""}`);
  }
  return lines.join("\n");
}

module.exports = { RETRY_WINDOW_MS, LOG_MAX, SERVER_RETRY_MS, createLoadState, onStuck, retryHow, pathOnly, addEntry, parseLog, formatReport, clock };
