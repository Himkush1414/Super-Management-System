// Shared helpers for the inventory scripts: .env.local, running SQL on the
// live project (Management API) or calling an RPC with the service role.
// Never prints a secret value.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** KEY=VALUE pairs of the env file (INVENTORY_ENV_FILE, else ./.env.local). Process env wins. */
export function loadEnv() {
  const file = resolve(process.env.INVENTORY_ENV_FILE || ".env.local");
  const out = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  return { file, get: (k) => process.env[k] || out[k] || "" };
}

/** A Windows path ("C:\Users\…") as WSL sees it ("/mnt/c/Users/…") when running on Linux. */
export function localPath(p) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (m && process.platform !== "win32") return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
  return p;
}

/** Project ref from SUPABASE_PROJECT_REF or a *.supabase.co URL. */
export function projectRef(env) {
  const ref = env.get("SUPABASE_PROJECT_REF");
  if (ref) return ref;
  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co/.exec(env.get("NEXT_PUBLIC_SUPABASE_URL"));
  return m ? m[1] : "";
}

/** Run SQL on the live project with SUPABASE_ACCESS_TOKEN (Management API). Returns the rows. */
export async function managementQuery(env, sql) {
  const token = env.get("SUPABASE_ACCESS_TOKEN");
  const ref = projectRef(env);
  if (!token || !ref) throw new Error("SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required");
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`database said ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/** A dollar-quote tag that doesn't occur in `text`. */
export function dollarTag(text) {
  for (let i = 0; ; i++) {
    const tag = `$nr${i.toString(36)}$`;
    if (!text.includes(tag)) return tag;
  }
}

/** Call an RPC with the service role (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). */
export async function serviceRpc(env, fn, args) {
  const url = env.get("NEXT_PUBLIC_SUPABASE_URL");
  const key = env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`database said ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
