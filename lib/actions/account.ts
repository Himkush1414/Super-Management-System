"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";

export type Result = { error?: string; ok?: string };

export async function updateProfile(
  _prev: Result | null,
  formData: FormData,
): Promise<Result> {
  const ctx = await requireSession();
  const full_name = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  if (!full_name) return { error: "Name can't be empty." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name, phone })
    .eq("id", ctx.userId);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/settings");
  return { ok: "Profile updated." };
}

export async function signOutEverywhere(): Promise<Result> {
  const ctx = await requireSession();
  if (!["head_admin", "admin"].includes(ctx.role))
    return { error: "Not available for your role." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "global" });
  if (error) return { error: error.message };
  return { ok: "Signed out of all devices." };
}
