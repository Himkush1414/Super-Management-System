// Boots PGlite (Postgres 17, in-process) with a minimal Supabase-like shim
// (roles, auth schema, auth.uid(), realtime publication) and applies every
// migration in the repo in order. Local only — never touches a real database.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SHIM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator noinherit login;
create role supabase_auth_admin;
grant anon, authenticated, service_role to authenticator;
create schema extensions;
create extension pgcrypto schema extensions;
create extension "uuid-ossp" schema extensions;
alter database template1 set search_path = public, extensions;
set search_path = public, extensions;
create schema auth;
create table auth.users (
  id uuid primary key, instance_id uuid, aud text, role text, email text, encrypted_password text,
  email_confirmed_at timestamptz, last_sign_in_at timestamptz, raw_app_meta_data jsonb,
  raw_user_meta_data jsonb, created_at timestamptz default now(), updated_at timestamptz default now(),
  confirmation_token text, email_change text, email_change_token_new text, recovery_token text);
create table auth.identities (id uuid primary key, user_id uuid, provider_id text, identity_data jsonb,
  provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public, extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create publication supabase_realtime;
`;

export function migrationFiles(repo) {
  const dir = join(repo, "supabase/migrations");
  return readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort().map((f) => ({ name: f, sql: readFileSync(join(dir, f), "utf8") }));
}

export async function makeDb(repo, { upTo, skip = [] } = {}) {
  const db = await PGlite.create({ extensions: { pgcrypto, uuid_ossp } });
  await db.exec(SHIM);
  for (const m of migrationFiles(repo)) {
    if (skip.includes(m.name)) continue;
    if (upTo && m.name > upTo) break;
    try {
      await db.exec(`set search_path = public, extensions;\n${m.sql}`);
    } catch (e) {
      throw new Error(`migration ${m.name} failed: ${e.message}`);
    }
  }
  return db;
}

export async function applyFile(db, repo, name) {
  const sql = readFileSync(join(repo, "supabase/migrations", name), "utf8");
  await db.exec(`set search_path = public, extensions;\n${sql}`);
}

/** Run `fn(tx)` as a signed-in account, exactly like PostgREST does (rolled back if it throws). */
export async function asUser(db, userId, fn, { role = "authenticated" } = {}) {
  try {
    return await db.transaction(async (tx) => {
      await tx.exec(`set local session authorization authenticator; set local role ${role};`);
      const claims = JSON.stringify(userId ? { sub: userId, role } : { role });
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
      return fn(tx);
    });
  } finally {
    // PGlite keeps a LOCAL session authorization after the transaction: undo it
    await db.exec(`set session authorization postgres; reset role;`);
  }
}
