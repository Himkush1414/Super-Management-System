// @ts-check
// Runs the real Edge Function file (supabase/mobile/functions/notify-new-order)
// under Node's TypeScript stripping, with a fake Deno runtime, a fake
// PostgREST and a fake Expo push API. Nothing here touches a network.
import test from "node:test";
import assert from "node:assert/strict";

const ORDER = "5f0c0b2e-1111-2222-3333-444455556666";
const MKT = "00000000-0000-0000-0000-0000000000a1";
const PROD1 = "00000000-0000-0000-0000-0000000000b1";
const PROD2 = "00000000-0000-0000-0000-0000000000b2";
const ADMIN = "00000000-0000-0000-0000-0000000000c1";
const HEAD = "00000000-0000-0000-0000-0000000000c2";
const SECRET = "test-secret-value-123";

/** @type {(req: Request) => Promise<Response>} */
let handler;
const env = {
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  NR_WEBHOOK_SECRET: SECRET,
};
/** @type {any} */ (globalThis).Deno = {
  env: { get: (/** @type {string} */ k) => /** @type {any} */ (env)[k] },
  serve: (/** @type {any} */ h) => (handler = h),
};
const mod = await import("../../supabase/mobile/functions/notify-new-order/index.ts");

/**
 * A fake backend. `tokens` maps user id -> push tokens.
 * @param {{ tokens?: Record<string, string[]>, items?: number, expo?: (msgs: any[]) => any, order?: any }} [o]
 */
function backend(o = {}) {
  const claimed = new Set();
  const calls = /** @type {{ method: string, url: string, body?: any, headers: Headers }[]} */ ([]);
  /** @type {any[][]} */ const expoBatches = [];
  const order = o.order ?? {
    id: ORDER,
    created_by: MKT,
    client_name: "Shree Ganesh Traders",
    product_name: "TRANSFORMER 250 KVA",
    quantity: 2,
    expected_delivery: "2026-11-05",
    status: "active",
  };
  const tokens = o.tokens ?? {
    [PROD1]: ["ExponentPushToken[prod1aaaaaaaa]"],
    [ADMIN]: ["ExponentPushToken[adminaaaaaaaa]"],
    [MKT]: ["ExponentPushToken[mktaaaaaaaaaa]"],
  };
  /** @type {any} */ (globalThis).fetch = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body, headers: new Headers(init.headers) });
    const ok = (/** @type {any} */ data) => new Response(JSON.stringify(data), { status: 200 });
    if (url.startsWith("https://exp.host/")) {
      expoBatches.push(body);
      return ok(o.expo ? o.expo(body) : { data: body.map(() => ({ status: "ok", id: "t" })) });
    }
    const path = decodeURIComponent(url.replace("https://proj.supabase.co/rest/v1/", ""));
    if (path === "order_push_log" && method === "POST") {
      if (claimed.has(body.order_id)) return ok([]);
      claimed.add(body.order_id);
      return ok([body]);
    }
    if (path.startsWith("order_push_log?") && method === "PATCH") return ok([]);
    if (path.startsWith("orders?")) return ok(path.includes(ORDER) ? [order] : []);
    if (path.startsWith("order_items?")) return ok(Array.from({ length: o.items ?? 1 }, (_, i) => ({ position: i + 1 })));
    if (path.startsWith("order_assignees?")) return ok([{ profile_id: PROD1 }, { profile_id: PROD2 }]);
    if (path.startsWith("profiles?")) return ok([{ id: ADMIN }, { id: HEAD }]);
    if (path.startsWith("device_tokens?") && method === "GET") {
      const ids = /user_id=in\.\(([^)]*)\)/.exec(path)?.[1].split(",") ?? [];
      return ok(ids.flatMap((id) => (tokens[id] ?? []).map((t) => ({ expo_push_token: t }))));
    }
    if (path.startsWith("device_tokens?") && method === "PATCH") return ok([]);
    return new Response("not found", { status: 404 });
  };
  return { calls, expoBatches };
}

/** @param {any} body @param {string} [secret] */
const call = (body, secret = SECRET) =>
  handler(
    new Request("https://proj.supabase.co/functions/v1/notify-new-order", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-nr-webhook-secret": secret },
      body: JSON.stringify(body),
    }),
  );
const insert = { type: "INSERT", schema: "public", table: "orders", record: { id: ORDER } };

test("wrong or missing secret is refused before anything is read", async () => {
  const b = backend();
  assert.equal((await call(insert, "nope")).status, 401);
  assert.equal((await call(insert, "")).status, 401);
  assert.equal(b.calls.length, 0);
});

test("notifies assigned production + admin tier, never the marketing creator", async () => {
  const b = backend();
  const res = await call(insert);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.recipients, 4); // prod1, prod2, admin, head_admin
  assert.equal(out.devices, 2); // only prod1 and admin have phones registered
  assert.equal(out.sent, 2);
  const to = b.expoBatches.flat().map((m) => m.to).sort();
  assert.deepEqual(to, ["ExponentPushToken[adminaaaaaaaa]", "ExponentPushToken[prod1aaaaaaaa]"]);
  const tokenQuery = b.calls.find((c) => c.url.includes("device_tokens?"));
  assert.ok(tokenQuery && !decodeURIComponent(tokenQuery.url).includes(MKT), "creator is not even queried");
});

test("message uses real order fields, the new_orders channel, sound, and no money", async () => {
  const b = backend();
  await call(insert);
  const m = b.expoBatches[0][0];
  assert.equal(m.title, "New order · Shree Ganesh Traders");
  assert.equal(m.body, "TRANSFORMER 250 KVA · Qty 2 · Delivery 05/11/2026");
  assert.equal(m.channelId, "new_orders");
  assert.equal(m.sound, "default");
  assert.equal(m.priority, "high");
  assert.deepEqual(m.data, { type: "new_order", orderId: ORDER, url: `/dashboard/orders/${ORDER}` });
  assert.doesNotMatch(JSON.stringify(m), /price|gst|amount|₹/i);
  const orderQuery = b.calls.find((c) => c.url.includes("/orders?"));
  assert.ok(orderQuery && !orderQuery.url.includes("price"), "price is never even selected");
});

test("multi-product orders are named like the website: first product +N more", async () => {
  const b = backend({ items: 3 });
  await call(insert);
  assert.equal(b.expoBatches[0][0].body, "TRANSFORMER 250 KVA +2 more · Delivery 05/11/2026");
});

test("the same order is never notified twice", async () => {
  const b = backend();
  assert.equal((await (await call(insert)).json()).sent, 2);
  const again = await (await call(insert)).json();
  assert.deepEqual(again, { skipped: "already notified" });
  assert.equal(b.expoBatches.length, 1);
});

test("a phone registered by two of the recipients gets one notification", async () => {
  const shared = "ExponentPushToken[sharedaaaaaa]";
  const b = backend({ tokens: { [PROD1]: [shared], [ADMIN]: [shared] } });
  const out = await (await call(insert)).json();
  assert.equal(out.devices, 1);
  assert.equal(b.expoBatches.flat().length, 1);
});

test("DeviceNotRegistered marks that token invalid", async () => {
  const b = backend({
    expo: (msgs) => ({
      data: msgs.map((/** @type {any} */ m) =>
        m.to.includes("prod1") ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } } : { status: "ok" },
      ),
    }),
  });
  const out = await (await call(insert)).json();
  assert.equal(out.sent, 1);
  assert.equal(out.failed, 1);
  const patch = b.calls.find((c) => c.method === "PATCH" && c.url.includes("device_tokens"));
  assert.ok(patch, "token invalidated");
  assert.match(decodeURIComponent(patch.url), /ExponentPushToken\[prod1aaaaaaaa\]/);
  assert.ok(patch.body.invalidated_at);
});

test("non-insert payloads and bad ids are ignored", async () => {
  backend();
  assert.deepEqual(await (await call({ type: "UPDATE", table: "orders", record: { id: ORDER } })).json(), {
    skipped: "not an order insert",
  });
  assert.equal((await call({ type: "INSERT", table: "orders", record: { id: "x" } })).status, 400);
});

test("messageFor: waiting orders say so; long names are clipped", () => {
  const { title, body } = mod.messageFor(
    {
      id: ORDER,
      created_by: MKT,
      client_name: "A".repeat(100),
      product_name: "P",
      quantity: 1,
      expected_delivery: null,
      status: "waiting_on_production_phone",
    },
    1,
  );
  assert.equal(title.length, "New order · ".length + 60);
  assert.equal(body, "P · Qty 1 · Waiting on production phone");
});
