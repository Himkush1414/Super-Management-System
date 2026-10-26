// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import links from "../src/links.js";

const { makePolicy, decide, deepLink, isRootPage } = links;

const policy = makePolicy("https://super-management-system-tau.vercel.app", "https://abc123.supabase.co");

test("website and Supabase over HTTPS stay in the app", () => {
  assert.equal(decide("https://super-management-system-tau.vercel.app/dashboard/orders", policy), "load");
  assert.equal(decide("https://abc123.supabase.co/auth/v1/verify", policy), "load");
  assert.equal(decide("about:blank", policy), "load");
});

test("cleartext to our own hosts is blocked", () => {
  assert.equal(decide("http://super-management-system-tau.vercel.app/login", policy), "block");
  assert.equal(decide("http://abc123.supabase.co/", policy), "block");
});

test("other sites and contact links open outside the app", () => {
  assert.equal(decide("https://wa.me/919999999999", policy), "external");
  assert.equal(decide("https://evil.example/super-management-system-tau.vercel.app", policy), "external");
  assert.equal(decide("https://super-management-system-tau.vercel.app.evil.example/", policy), "external");
  assert.equal(decide("mailto:office@example.com", policy), "external");
  assert.equal(decide("tel:+911234567890", policy), "external");
});

test("dangerous schemes are blocked", () => {
  for (const u of ["javascript:alert(1)", "file:///etc/hosts", "intent://x#Intent;end", "blob:https://x/y", "data:text/html,hi", "not a url"]) {
    assert.equal(decide(u, policy), "block", u);
  }
});

test("a missing or malformed Supabase URL only drops that host", () => {
  const p = makePolicy("https://super-management-system-tau.vercel.app", "::bad::");
  assert.deepEqual(p.allowedHosts, ["super-management-system-tau.vercel.app"]);
  assert.equal(decide("https://super-management-system-tau.vercel.app/", p), "load");
});

test("notification deep links resolve to same-site pages only", () => {
  const base = "https://super-management-system-tau.vercel.app";
  assert.equal(deepLink("/dashboard/orders/5f0c0b2e-1111-2222-3333-444455556666", policy), `${base}/dashboard/orders/5f0c0b2e-1111-2222-3333-444455556666`);
  assert.equal(deepLink("//evil.example/x", policy), `${base}/dashboard/orders`);
  assert.equal(deepLink("https://evil.example/", policy), `${base}/dashboard/orders`);
  assert.equal(deepLink(undefined, policy), `${base}/dashboard/orders`);
  assert.equal(deepLink(42, policy), `${base}/dashboard/orders`);
});

test("root pages exit on back instead of navigating", () => {
  const base = "https://super-management-system-tau.vercel.app";
  assert.equal(isRootPage(`${base}/login`), true);
  assert.equal(isRootPage(`${base}/dashboard/orders/`), true);
  assert.equal(isRootPage(`${base}/dashboard/orders?x=1`), true);
  assert.equal(isRootPage(`${base}/dashboard/orders/abc`), false);
  assert.equal(isRootPage(`${base}/dashboard/settings`), false);
});
