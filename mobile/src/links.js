// @ts-check
// URL policy for the WebView. Pure functions (no React Native imports) so
// they run under `node --test` as well as in the app.

/**
 * @typedef {{ webOrigin: string, allowedHosts: string[] }} Policy
 * @typedef {"load" | "external" | "block"} Decision
 */

/**
 * @param {string} webUrl  production website, e.g. https://example.vercel.app
 * @param {string} [supabaseUrl]  e.g. https://xyz.supabase.co
 * @returns {Policy}
 */
function makePolicy(webUrl, supabaseUrl) {
  const web = new URL(webUrl);
  const hosts = [web.host];
  if (supabaseUrl) {
    try {
      hosts.push(new URL(supabaseUrl).host);
    } catch {
      // a malformed EAS variable must not break navigation to the website
    }
  }
  return { webOrigin: web.origin, allowedHosts: hosts };
}

/**
 * What to do with a navigation request.
 * - "load": the website (or its Supabase project) over HTTPS — stay in the app
 * - "external": any other http(s)/mailto/tel/whatsapp link — hand to the OS
 * - "block": everything else (cleartext to our hosts, javascript:, file:, intent: …)
 *
 * @param {string} url
 * @param {Policy} policy
 * @returns {Decision}
 */
function decide(url, policy) {
  // in-page documents the WebView creates itself
  if (url === "about:blank" || url.startsWith("about:srcdoc")) return "load";
  if (url.startsWith("blob:") || url.startsWith("data:")) return "block";

  let u;
  try {
    u = new URL(url);
  } catch {
    return "block";
  }
  const ours = policy.allowedHosts.includes(u.host);
  if (u.protocol === "https:") return ours ? "load" : "external";
  if (u.protocol === "http:") return ours ? "block" : "external";
  if (["mailto:", "tel:", "sms:", "whatsapp:"].includes(u.protocol)) return "external";
  return "block";
}

/**
 * A full website URL for an app-relative path from a push payload.
 * Anything that isn't a same-site path falls back to the orders list.
 *
 * @param {unknown} path
 * @param {Policy} policy
 */
function deepLink(path, policy) {
  const fallback = `${policy.webOrigin}/dashboard/orders`;
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return fallback;
  try {
    const u = new URL(path, policy.webOrigin);
    return u.origin === policy.webOrigin ? u.toString() : fallback;
  } catch {
    return fallback;
  }
}

/** Pages where the hardware back button leaves the app instead of going back. */
const ROOT_PATHS = ["/", "/login", "/dashboard", "/dashboard/orders"];

/** @param {string} url */
function isRootPage(url) {
  try {
    const p = new URL(url).pathname.replace(/\/+$/, "") || "/";
    return ROOT_PATHS.includes(p);
  } catch {
    return false;
  }
}

module.exports = { makePolicy, decide, deepLink, isRootPage };
