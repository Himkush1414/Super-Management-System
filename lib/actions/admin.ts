"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type Result = { error?: string; ok?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every delete here runs under the ADMIN'S OWN session (not the service
 * role): the orders_admin_delete / ose_admin_delete RLS policies and
 * admin_reset_account()'s own check are the real gate, and the audit
 * triggers record the signed-in admin as the actor (migration 0013). The
 * `data.delete` check below only fails fast with a clear message.
 */
async function adminContext() {
  const ctx = await requireSession();
  if (!ctx.can("data.delete")) return null;
  return ctx;
}

function revalidateAll() {
  revalidatePath("/dashboard", "layout");
}

export async function deleteOrder(orderId: string, opts?: { redirectTo?: string }): Promise<Result> {
  if (!(await adminContext())) return { error: "Not permitted." };
  if (!UUID.test(orderId)) return { error: "Order not found." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("orders").delete().eq("id", orderId).select("id");
  if (error) return { error: "Could not delete the order. Please try again." };
  if (!data?.length) return { error: "Order not found — it may already have been deleted." };

  revalidateAll();
  if (opts?.redirectTo) redirect(opts.redirectTo);
  return { ok: "Order deleted. The deletion is recorded in the activity log." };
}

export async function deleteStageEvent(eventId: string): Promise<Result> {
  if (!(await adminContext())) return { error: "Not permitted." };
  if (!UUID.test(eventId)) return { error: "Stage update not found." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("order_stage_events")
    .delete()
    .eq("id", eventId)
    .select("id");
  if (error) return { error: "Could not delete the stage update. Please try again." };
  if (!data?.length) return { error: "Stage update not found — it may already have been deleted." };

  revalidateAll();
  return { ok: "Stage update deleted. The deletion is recorded in the activity log." };
}

export async function resetAccount(_prev: Result | null, fd: FormData): Promise<Result> {
  if (!(await adminContext())) return { error: "Not permitted." };

  const profileId = String(fd.get("profile_id") ?? "");
  const confirmText = String(fd.get("confirm") ?? "").trim();
  if (!UUID.test(profileId)) return { error: "Account not found." };

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("username, role")
    .eq("id", profileId)
    .maybeSingle();
  if (!target || !["marketing", "production"].includes(target.role)) {
    return { error: "Only marketing or production accounts can be reset." };
  }
  // Server-side half of the confirmation step: the typed username must match.
  if (confirmText.toLowerCase() !== String(target.username).toLowerCase()) {
    return { error: `Type ${target.username} exactly to confirm.` };
  }

  const scopes = {
    p_orders: fd.get("orders") === "on",
    p_stage_events: fd.get("stage_events") === "on",
    p_notifications: fd.get("notifications") === "on",
  };
  if (!scopes.p_orders && !scopes.p_stage_events && !scopes.p_notifications) {
    return { error: "Select at least one kind of data to delete." };
  }

  const { data, error } = await supabase.rpc("admin_reset_account", {
    p_profile_id: profileId,
    ...scopes,
  });
  if (error) return { error: "Could not reset the account. Nothing was deleted." };

  const c = data as { orders: number; stage_updates: number; notifications: number };
  revalidateAll();
  return {
    ok: `Reset ${target.username}: ${c.orders} order(s), ${c.stage_updates} stage update(s), ${c.notifications} notification(s) deleted. Recorded in the activity log.`,
  };
}
