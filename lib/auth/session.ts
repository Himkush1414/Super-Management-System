import "server-only";

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

/**
 * Resolve the signed-in account for a dashboard route. No pending/suspended
 * states exist any more — an account either is one of the fixed seeded rows
 * or it isn't signed in.
 */
export async function requireSession(): Promise<SessionContext> {
  const supabase = await createClient();
  // See lib/supabase/middleware.ts — cap the Auth server round trip so a
  // slow/unreachable Auth server can't hang every dashboard render.
  const user = await Promise.race([
    supabase.auth.getUser().then((r) => r.data.user),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
  ]).catch(() => null);

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile) {
    await supabase.auth.signOut();
    redirect("/login");
  }

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
}

export async function requireRole(...roles: Role[]): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!roles.includes(ctx.role)) redirect("/dashboard/orders");
  return ctx;
}
