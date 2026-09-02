import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/database.types";
import { type Permission, type Role, can } from "@/lib/permissions";

export interface SessionContext {
  userId: string;
  email: string | null;
  profile: Profile;
  role: Role;
  can: (perm: Permission) => boolean;
}

/**
 * Resolve the current user + profile for a dashboard route. Redirects to the
 * right place when the user isn't signed in or isn't active. Middleware already
 * guards these routes — this is the in-page contract + data source.
 */
export async function requireSession(): Promise<SessionContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin");

  const { data: profileData } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  const profile = profileData as Profile | null;

  if (!profile) redirect("/signin");
  if (profile.status !== "active") redirect("/pending-approval");

  const role = profile.role as Role;
  return {
    userId: user.id,
    email: user.email ?? null,
    profile,
    role,
    can: (perm) => can(role, perm),
  };
}

export async function requirePermission(perm: Permission): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!ctx.can(perm)) redirect("/dashboard/overview?denied=1");
  return ctx;
}
