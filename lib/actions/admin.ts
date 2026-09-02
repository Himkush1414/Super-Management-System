"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/permissions";

export type Result = { error?: string; ok?: string };

export async function reviewSignup(
  requestId: string,
  decision: "approved" | "rejected",
  note?: string,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_signup_request", {
    request_id: requestId,
    decision,
    note: note ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/approvals");
  revalidatePath("/dashboard/overview");
  return { ok: decision === "approved" ? "User approved." : "Request rejected." };
}

export async function changeUserRole(
  target: string,
  newRole: Role,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_role", {
    target,
    new_role: newRole,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/users");
  revalidatePath("/dashboard/audit-log");
  return { ok: "Role updated." };
}
