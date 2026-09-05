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

const INACTIVITY_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Resolve the current user + profile for a dashboard route. Redirects to
 * sign-in when the user isn't signed in, or when a non-Head-Admin session has
 * been inactive for 7+ days (spec §2 — forced re-login). Pending/rejected
 * accounts are NOT redirected away — they reach the dashboard shell, which
 * renders the PendingGate instead of the real page content.
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
  if (profile.status === "suspended") {
    await supabase.auth.signOut();
    redirect("/signin");
  }

  const role = profile.role as Role;

  if (role !== "head_admin") {
    const lastActive = profile.last_active_at ? new Date(profile.last_active_at).getTime() : 0;
    if (Date.now() - lastActive > INACTIVITY_LIMIT_MS) {
      await supabase.auth.signOut();
      redirect("/signin");
    }
  }

  await supabase
    .from("profiles")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", user.id);

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
