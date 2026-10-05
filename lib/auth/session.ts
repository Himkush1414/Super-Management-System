import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/database.types";
import { type Permission, type Role, can, isAdminTier } from "@/lib/permissions";
import { displayName } from "@/lib/names";

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
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession(); // local cookie read (the proxy keeps it fresh)
  const sub = tokenSubject(session?.access_token);
  if (!sub) redirect("/login");

  const [user, { data: profile }, { data: settings }] = await Promise.all([
    // Cap the Auth round trip so a slow/unreachable Auth server can't hang
    // every dashboard render (see lib/supabase/middleware.ts).
    Promise.race([
      supabase.auth.getUser().then((r) => r.data.user),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]).catch(() => null),
    supabase.from("profiles").select("*").eq("id", sub).maybeSingle<Profile>(),
    // RLS: production reads its own row; everyone else gets nothing.
    supabase
      .from("production_settings")
      .select("phone, confirmed_at")
      .eq("profile_id", sub)
      .maybeSingle<{ phone: string | null; confirmed_at: string | null }>(),
  ]);

  if (!user || user.id !== sub || !profile) redirect("/login");

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
