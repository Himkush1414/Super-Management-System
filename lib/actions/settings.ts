"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { cleanRealName } from "@/lib/names";
import { createOrderGroup } from "@/lib/whatsapp";

export type Result = { error?: string; ok?: string };

/**
 * Marketing / production account setup: the real name (both roles) and, for
 * production, the WhatsApp phone number. Profiles aren't writable through the
 * API (0014), so this goes through the service role after the session check.
 *
 * Production: "confirm" means the account attests to the number (there's no
 * way to verify it without the WhatsApp API), so confirmed_at is set on save.
 * Waiting orders this member is assigned to are activated once EVERY assigned
 * member has both a real name and a confirmed phone (activate_ready_orders).
 */
export async function saveSettings(_prev: Result | null, fd: FormData): Promise<Result> {
  const ctx = await requireSession({ allowIncompleteSetup: true });
  if (ctx.role !== "marketing" && ctx.role !== "production") return { error: "Not permitted." };
  const svc = createServiceClient();

  const realName = cleanRealName(String(fd.get("real_name") ?? ""));
  if (!realName) {
    return { error: "Enter your real name (2–80 letters; spaces, . ' - allowed)." };
  }

  let phone: string | null = null;
  if (ctx.role === "production") {
    phone = String(fd.get("phone") ?? "").trim().replace(/[\s()-]/g, "");
    if (!/^\+?\d{8,15}$/.test(phone)) {
      return { error: "Enter a valid phone number (8–15 digits, optional leading +)." };
    }
  }

  const [{ error: nameErr }, { error: phoneErr }] = await Promise.all([
    svc.from("profiles").update({ real_name: realName }).eq("id", ctx.userId),
    phone
      ? svc.from("production_settings").upsert({
          profile_id: ctx.userId,
          phone,
          confirmed_at: new Date().toISOString(),
        })
      : Promise.resolve({ error: null }),
  ]);
  if (nameErr || phoneErr) return { error: "Could not save. Please try again." };

  let activated = 0;
  if (ctx.role === "production") {
    const { data } = await svc.rpc("activate_ready_orders", { p_profile_id: ctx.userId });
    const orders = (data ?? []) as {
      order_id: string;
      created_by: string;
      product_name: string;
      assignee_ids: string[];
    }[];
    activated = orders.length;

    if (orders.length) {
      // Side effects (WhatsApp stub + notifications) don't block the response.
      after(async () => {
        const memberIds = [...new Set(orders.flatMap((o) => o.assignee_ids))];
        const [{ data: phones }, { data: heads }] = await Promise.all([
          svc.from("production_settings").select("profile_id, phone").in("profile_id", memberIds),
          svc.from("profiles").select("id").eq("role", "head_admin"),
        ]);
        const phoneOf = new Map((phones ?? []).map((p) => [p.profile_id as string, p.phone as string]));
        const headIds = (heads ?? []).map((h) => h.id as string);
        await Promise.all([
          ...orders.map((o) =>
            createOrderGroup({
              orderId: o.order_id,
              productName: o.product_name,
              productionPhones: o.assignee_ids.map((id) => phoneOf.get(id)!).filter(Boolean),
            }),
          ),
          svc.from("notifications").insert(
            orders.flatMap((o) =>
              [...new Set([o.created_by, ...headIds, ...o.assignee_ids])].map((user_id) => ({
                user_id,
                type: "order",
                title: "Order activated",
                body: `"${o.product_name}" is now active — every assigned production member has finished setup.`,
                entity_type: "order",
                entity_id: o.order_id,
              })),
            ),
          ),
        ]);
      });
    }
  }

  revalidatePath("/dashboard", "layout");
  // First-time setup is now complete (every required field was just saved).
  if (ctx.missingSetup.length) redirect("/dashboard/orders");
  return {
    ok:
      activated > 0
        ? `Saved. ${activated} order(s) waiting on your details are now active.`
        : "Saved.",
  };
}
