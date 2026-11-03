/**
 * fetch for the Supabase clients, with a time limit where one is safe.
 *
 * Next's router waits for a page's server answer with no time limit of its
 * own, so a database read that stalls used to hold the loading skeleton on
 * screen until the function itself was killed. With this, a stalled read
 * fails after SUPABASE_TIMEOUT_MS and the page shows "Try again" instead.
 *
 * Timed: reads (GET / HEAD) and every Auth call (session checks and token
 * refreshes, which are safe to repeat). NOT timed: writes (POST / PATCH /
 * DELETE to the database, RPCs included): a write that is cut off on our
 * side may still have been saved, and repeating it could, for example,
 * punch the same order twice. Realtime (websocket) is not affected.
 */
export const SUPABASE_TIMEOUT_MS = 8000;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function isTimed(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  let path = "";
  try {
    path = new URL(urlOf(input)).pathname;
  } catch {
    return false;
  }
  if (path.startsWith("/auth/v1/")) return true;
  return method === "GET" || method === "HEAD";
}

/**
 * The limit aborts with a plain AbortError, not AbortSignal.timeout()'s
 * TimeoutError, on purpose: the database client (postgrest-js) retries a
 * failed read up to 3 more times, except when it was aborted. A read that
 * hung for 8 s would otherwise be sent four times (about 38 s) before the
 * page gave up. Its quick retries of a 503/520 answer are unaffected.
 */
export function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!isTimed(input, init)) return fetch(input, init);
  const limit = new AbortController();
  const timer = setTimeout(() => limit.abort(), SUPABASE_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, limit.signal]) : limit.signal;
  return fetch(input, { ...init, signal }).finally(() => clearTimeout(timer));
}
