"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { createOrderGroup } from "@/lib/whatsapp";

export type Result = { error?: string; ok?: string };

/**
 * A production account registers / confirms its phone number (spec §5).
 * There is no way to actually verify the number without the WhatsApp API, so
 * "confirm" here means the account has attested to it; `confirmed_at` is set
 * on save. Any of that account's orders that were parked on
 * `waiting_on_production_phone` are activated immediately.
 */
export async function saveProductionPhone(
  _prev: Result | null,
  fd: FormData,
): Promise<Result> {
  const ctx = await requireRole("production");
  const svc = createServiceClient();

  const raw = String(fd.get("phone") ?? "").trim();
  const phone = raw.replace(/[\s()-]/g, "");
  if (!/^\+?\d{8,15}$/.test(phone)) {
    return { error: "Enter a valid phone number (8–15 digits, optional leading +)." };
  }

  const { error } = await svc.from("production_settings").upsert({
    profile_id: ctx.userId,
    phone,
    confirmed_at: new Date().toISOString(),
  });
  if (error) return { error: error.message };

  // Activate any parked orders for this production account.
  const { data: parked } = await svc
    .from("orders")
    .select("id, created_by, product_name")
    .eq("assigned_to", ctx.userId)
    .eq("status", "waiting_on_production_phone");

  for (const o of parked ?? []) {
    await svc
      .from("orders")
      .update({ status: "active", production_phone: phone })
      .eq("id", o.id);

    await createOrderGroup({
      orderId: o.id,
      productName: o.product_name,
      productionPhone: phone,
    });

    const { data: heads } = await svc
      .from("profiles")
      .select("id")
      .eq("role", "head_admin");

    const recipients = [
      ...new Set([o.created_by, ...(heads ?? []).map((h) => h.id as string)]),
    ];
    if (recipients.length) {
      await svc.from("notifications").insert(
        recipients.map((user_id) => ({
          user_id,
          type: "order",
          title: "Order activated",
          body: `"${o.product_name}" is now active — production phone number registered.`,
          entity_type: "order",
          entity_id: o.id,
        })),
      );
    }
  }

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/orders");
  return {
    ok:
      (parked?.length ?? 0) > 0
        ? `Saved. ${parked!.length} order(s) waiting on your number are now active.`
        : "Saved. This number will be used for WhatsApp group creation.",
  };
}
