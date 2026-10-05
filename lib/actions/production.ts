"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { createOrderGroup } from "@/lib/whatsapp";

export type Result = { error?: string; ok?: string };

/**
 * A production account registers / confirms its phone number (spec §5).
 * There is no way to actually verify the number without the WhatsApp API, so
 * "confirm" here means the account has attested to it; `confirmed_at` is set
 * on save. Orders parked on `waiting_on_production_phone` that this account
 * is assigned to are activated once EVERY member assigned to them has a
 * confirmed number.
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

  const [{ error }, { data: mine }] = await Promise.all([
    svc.from("production_settings").upsert({
      profile_id: ctx.userId,
      phone,
      confirmed_at: new Date().toISOString(),
    }),
    // This account's parked orders, with all of each order's assignees.
    svc
      .from("orders")
      .select("id, created_by, product_name, mine:order_assignees!inner(profile_id), all:order_assignees(profile_id)")
      .eq("status", "waiting_on_production_phone")
      .eq("mine.profile_id", ctx.userId),
  ]);
  if (error) return { error: "Could not save the number. Please try again." };

  type Parked = {
    id: string;
    created_by: string;
    product_name: string;
    all: { profile_id: string }[];
  };
  const parked = (mine ?? []) as unknown as Parked[];

  let activated: (Parked & { phones: string[] })[] = [];
  if (parked.length) {
    const memberIds = [...new Set(parked.flatMap((o) => o.all.map((a) => a.profile_id)))];
    const { data: settings } = await svc
      .from("production_settings")
      .select("profile_id, phone, confirmed_at")
      .in("profile_id", memberIds);
    const phoneOf = new Map(
      (settings ?? [])
        .filter((s) => s.phone && s.confirmed_at)
        .map((s) => [s.profile_id as string, s.phone as string]),
    );
    phoneOf.set(ctx.userId, phone); // just saved

    activated = parked
      .filter((o) => o.all.every((a) => phoneOf.has(a.profile_id)))
      .map((o) => ({ ...o, phones: o.all.map((a) => phoneOf.get(a.profile_id)!) }));

    if (activated.length) {
      await svc
        .from("orders")
        .update({ status: "active" })
        .in(
          "id",
          activated.map((o) => o.id),
        )
        .eq("status", "waiting_on_production_phone");

      // Side effects (WhatsApp stub + notifications) don't need to finish
      // before the caller gets a response.
      after(async () => {
        const { data: heads } = await svc
          .from("profiles")
          .select("id")
          .eq("role", "head_admin");
        const headIds = (heads ?? []).map((h) => h.id as string);

        await Promise.all([
          ...activated.map((o) =>
            createOrderGroup({
              orderId: o.id,
              productName: o.product_name,
              productionPhones: o.phones,
            }),
          ),
          svc.from("notifications").insert(
            activated.flatMap((o) =>
              [...new Set([o.created_by, ...headIds, ...o.all.map((a) => a.profile_id)])].map(
                (user_id) => ({
                  user_id,
                  type: "order",
                  title: "Order activated",
                  body: `"${o.product_name}" is now active — every assigned production member has a phone number on file.`,
                  entity_type: "order",
                  entity_id: o.id,
                }),
              ),
            ),
          ),
        ]);
      });
    }
  }

  const stillWaiting = parked.length - activated.length;
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/orders");
  return {
    ok:
      activated.length > 0
        ? `Saved. ${activated.length} order(s) are now active.` +
          (stillWaiting ? ` ${stillWaiting} still wait on another member's number.` : "")
        : stillWaiting
          ? `Saved. ${stillWaiting} order(s) still wait on another assigned member's number.`
          : "Saved. This number will be used for WhatsApp group creation.",
  };
}
