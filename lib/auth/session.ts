import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/database.types";
import { type Permission, type Role, can, isAdminTier } from "@/lib/permissions";

export interface SessionContext {
  userId: string;
  username: string;
  name: string;
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
export const requireSession = cache(async (): Promise<SessionContext> => {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession(); // local cookie read (the proxy keeps it fresh)
  const sub = tokenSubject(session?.access_token);
  if (!sub) redirect("/login");

  const [user, { data: profile }] = await Promise.all([
    // Cap the Auth round trip so a slow/unreachable Auth server can't hang
    // every dashboard render (see lib/supabase/middleware.ts).
    Promise.race([
      supabase.auth.getUser().then((r) => r.data.user),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]).catch(() => null),
    supabase.from("profiles").select("*").eq("id", sub).maybeSingle<Profile>(),
  ]);

  if (!user || user.id !== sub || !profile) redirect("/login");

  const role = profile.role as Role;
  return {
    userId: user.id,
    username: profile.username,
    name: profile.full_name || profile.username,
    profile,
    role,
    isAdminTier: isAdminTier(role),
    can: (perm) => can(role, perm),
  };
});

export async function requireRole(...roles: Role[]): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!roles.includes(ctx.role)) redirect("/dashboard/orders");
  return ctx;
}
