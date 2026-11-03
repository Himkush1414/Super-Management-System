// node --test: which Supabase requests get a time limit (lib/supabase/fetch.ts)
import test from "node:test";
import assert from "node:assert/strict";
import { isTimed, timedFetch, SUPABASE_TIMEOUT_MS } from "../lib/supabase/fetch.ts";

const API = "https://abc.supabase.co";

test("database reads (GET / HEAD) are timed", () => {
  assert.equal(isTimed(`${API}/rest/v1/order_feed?select=*`), true);
  assert.equal(isTimed(`${API}/rest/v1/notifications?select=id`, { method: "HEAD" }), true);
  assert.equal(isTimed(new URL(`${API}/rest/v1/profiles`)), true);
});

test("database writes are never timed (a cut-off write may still have been saved)", () => {
  for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
    assert.equal(isTimed(`${API}/rest/v1/orders?id=eq.1`, { method }), false, method);
  }
  assert.equal(isTimed(`${API}/rest/v1/rpc/create_order`, { method: "POST" }), false);
  assert.equal(isTimed(new Request(`${API}/rest/v1/rpc/advance_order_stage`, { method: "POST" })), false);
});

test("every Auth call is timed (session checks and refreshes are safe to repeat)", () => {
  assert.equal(isTimed(`${API}/auth/v1/user`), true);
  assert.equal(isTimed(`${API}/auth/v1/token?grant_type=refresh_token`, { method: "POST" }), true);
});

test("a malformed address is passed through untouched", () => {
  assert.equal(isTimed("not a url"), false);
});

test("a read is sent with a time-limit signal, keeping the caller's own signal", async () => {
  assert.equal(SUPABASE_TIMEOUT_MS, 8000);
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    seen.push(init?.signal);
    return new Response("ok");
  };
  try {
    await timedFetch(`${API}/rest/v1/order_feed`);
    const mine = new AbortController();
    await timedFetch(`${API}/rest/v1/order_feed`, { signal: mine.signal });
    assert.ok(seen[0] instanceof AbortSignal && !seen[0].aborted);
    assert.ok(seen[1] instanceof AbortSignal && seen[1] !== mine.signal);
    mine.abort();
    assert.equal(seen[1].aborted, true, "the caller's abort still reaches the request");
  } finally {
    globalThis.fetch = real;
  }
});

test("the time limit aborts with AbortError (postgrest-js never retries an abort)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const real = globalThis.fetch;
  globalThis.fetch = (_input, init) =>
    new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  try {
    const p = timedFetch(`${API}/rest/v1/order_feed`);
    t.mock.timers.tick(SUPABASE_TIMEOUT_MS - 1);
    let settled = false;
    p.catch(() => {}).finally(() => (settled = true));
    await Promise.resolve();
    assert.equal(settled, false, "still waiting just before the limit");
    t.mock.timers.tick(1);
    await assert.rejects(p, (e) => e.name === "AbortError");
  } finally {
    globalThis.fetch = real;
  }
});

test("a write gets no signal of ours", async () => {
  let seen = "unset";
  const real = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    seen = init?.signal;
    return new Response("ok");
  };
  try {
    await timedFetch(`${API}/rest/v1/rpc/create_order`, { method: "POST", body: "{}" });
    assert.equal(seen, undefined);
  } finally {
    globalThis.fetch = real;
  }
});
