import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { isAuthApiError, isAuthRetryableFetchError, isAuthSessionMissingError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ReadError } from "@/lib/data/read";
import type { Profile } from "@/types/database.types";
import { ROLES, type Permission, type Role, can, isAdminTier } from "@/lib/permissions";
import { displayName } from "@/lib/names";
import { perf } from "@/lib/perf";

export interface SessionContext {
  userId: string;
  username: string;
  /** Display label: "Real Name (Production 1)" or the account's label. */
  name: string;
  /**
   * What this account still has to provide before it can use the app:
   * marketing -> real name; production -> real name + phone. Empty = ready.
   */
  missingSetup: ("real_name" | "phone")[];
  profile: Profile;
  role: Role;
  isAdminTier: boolean;
  can: (perm: Permission) => boolean;
}

/** `sub` claim of a JWT (no verification here — see requireSession). */
function tokenSubject(jwt: string | undefined): string | null {
  try {
    const payload = jwt?.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
}

/**
 * Did Auth actually answer "this session is not valid"? Only a 4xx answer
 * from the Auth server (revoked or expired session, user gone) or no
 * session at all. A timeout, a network failure or a 5xx is "couldn't
 * check", which must not look like a sign-out.
 */
function authSaysSignedOut(error: unknown): boolean {
  if (isAuthSessionMissingError(error)) return true;
  return isAuthApiError(error) && typeof error.status === "number" && error.status >= 400 && error.status < 500;
}

/**
 * Resolve the signed-in account for a dashboard route, route handler or
 * server action. An account either is one of the fixed seeded rows or it
 * isn't signed in.
 *
 * One round trip: the Auth-server check (getUser — catches revoked
 * sessions) and the profile read run in PARALLEL instead of one after the
 * other. The profile is fetched for the `sub` of the same access token
 * PostgREST verifies, and must match the user the Auth server returns.
 *
 * `cache()`-wrapped: the layout and the page both call this; one request
 * resolves it once.
 */
const loadSession = cache(async (): Promise<SessionContext> => {
  const pf = perf("session");
  const supabase = await createClient();
  // Local cookie read (the proxy keeps it fresh); it only goes to Auth when
  // the token has expired, and Auth retries a failing refresh for up to
  // 30 s, so it is capped like getUser below.
  const got = await Promise.race([
    supabase.auth.getSession(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
  ]);
  // The refresh couldn't reach Auth: unknown, not signed out (see below).
  if (got === null) throw new ReadError("the session", "no answer in 8 s");
  if (!got.data.session && isAuthRetryableFetchError(got.error)) throw new ReadError("the session", got.error);
  const sub = tokenSubject(got.data.session?.access_token);
  if (!sub) redirect("/login");

  const [checked, profileRes, settingsRes] = await Promise.all([
    // Cap the Auth round trip so a slow/unreachable Auth server can't hang
    // every dashboard render (see lib/supabase/middleware.ts).
    pf.time(
      "auth.getUser",
      Promise.race([
        supabase.auth.getUser(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
      ]).catch((e: unknown) => ({ data: { user: null }, error: e })),
    ),
    pf.time("profile", supabase.from("profiles").select("*").eq("id", sub).maybeSingle<Profile>()),
    // RLS: production reads its own row; everyone else gets nothing.
    pf.time(
      "production_settings",
      supabase
        .from("production_settings")
        .select("phone, confirmed_at")
        .eq("profile_id", sub)
        .maybeSingle<{ phone: string | null; confirmed_at: string | null }>(),
    ),
  ]);
  const user = checked?.data.user ?? null;
  pf.end({ user: Boolean(user) });

  // Two different answers, kept apart:
  //  * "signed out": Auth answered that this session is not valid (revoked,
  //    expired refresh, user gone) or the profile row doesn't exist -> /login;
  //  * "couldn't check": Auth or the database was too slow or unreachable ->
  //    an error with "Try again". Sending people to /login for that used to
  //    sign them out at random on a slow connection, and a failed settings
  //    read sent production to the Settings page as if its phone were missing.
  if (!user && !authSaysSignedOut(checked?.error)) {
    throw new ReadError("the sign-in check", checked === null ? "no answer in 5 s" : checked.error);
  }
  if (profileRes.error) throw new ReadError("the account", profileRes.error);
  if (settingsRes.error) throw new ReadError("the production settings", settingsRes.error);
  const profile = profileRes.data;
  const settings = settingsRes.data;

  if (!user || user.id !== sub || !profile) redirect("/login");
  // A role the app no longer has (the retired dispatchers, 0024): out.
  if (!(ROLES as readonly string[]).includes(profile.role)) redirect("/login/retired");

  const role = profile.role as Role;
  const missingSetup: SessionContext["missingSetup"] = [];
  if ((role === "marketing" || role === "production") && !profile.real_name) {
    missingSetup.push("real_name");
  }
  if (role === "production" && !(settings?.phone && settings.confirmed_at)) {
    missingSetup.push("phone");
  }
  return {
    userId: user.id,
    username: profile.username,
    name: displayName(profile),
    missingSetup,
    profile,
    role,
    isAdminTier: isAdminTier(role),
    can: (perm) => can(role, perm),
  };
});

/**
 * The signed-in account, for every page, route handler and server action.
 * Marketing / production accounts that haven't finished setup (real name;
 * production also phone) are sent to Settings — this is the hard gate, so
 * no page, export or action is reachable until it's done. Only the Settings
 * page and its save actions pass `{ allowIncompleteSetup: true }`.
 */
export async function requireSession(
  opts: { allowIncompleteSetup?: boolean } = {},
): Promise<SessionContext> {
  const ctx = await loadSession();
  if (ctx.missingSetup.length && !opts.allowIncompleteSetup) redirect("/dashboard/settings");
  return ctx;
}

export async function requireRole(...roles: Role[]): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!roles.includes(ctx.role)) redirect("/dashboard/orders");
  return ctx;
}
