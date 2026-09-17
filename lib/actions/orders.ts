"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession, requireRole } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { MAX_STAGE, STAGE_TIMER_MS, stageName } from "@/lib/orders";
import { createOrderGroup, postStageUpdate } from "@/lib/whatsapp";

export type Result = { error?: string; ok?: string; id?: string };

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function headAdminIds(svc: ReturnType<typeof createServiceClient>) {
  const { data } = await svc.from("profiles").select("id").eq("role", "head_admin");
  return (data ?? []).map((r) => r.id as string);
}

async function notify(
  svc: ReturnType<typeof createServiceClient>,
  userIds: string[],
  n: { type: string; title: string; body: string; entity_id: string },
) {
  const rows = [...new Set(userIds)].map((user_id) => ({
    user_id,
    type: n.type,
    title: n.title,
    body: n.body,
    entity_type: "order",
    entity_id: n.entity_id,
  }));
  if (rows.length) await svc.from("notifications").insert(rows);
}

/** Marketing dispatches an order to a chosen production account (spec §4, §5). */
export async function dispatchOrder(
  _prev: Result | null,
  fd: FormData,
): Promise<Result> {
  const ctx = await requireRole("marketing");
  const svc = createServiceClient();

  const product_name = str(fd, "product_name");
  const quality = str(fd, "quality");
  const power_type = str(fd, "power_type");
  const description = str(fd, "description");
  const assigned_to = str(fd, "assigned_to");
  const quantity = Number(str(fd, "quantity") || "1");
  const priceRaw = str(fd, "price");
  const price = priceRaw === "" ? null : Number(priceRaw);

  if (!product_name) return { error: "Product name is required." };
  if (!Number.isInteger(quantity) || quantity < 1)
    return { error: "Quantity must be a whole number of at least 1." };
  if (price !== null && (!Number.isFinite(price) || price < 0))
    return { error: "Price must be a positive number, or left blank." };
  if (!assigned_to) return { error: "Choose which production account to send this to." };

  const { data: prod } = await svc
    .from("profiles")
    .select("id, role, full_name, username")
    .eq("id", assigned_to)
    .single();
  if (!prod || prod.role !== "production")
    return { error: "That production account no longer exists." };

  const { data: settings } = await svc
    .from("production_settings")
    .select("phone, confirmed_at")
    .eq("profile_id", assigned_to)
    .maybeSingle();

  const phoneReady = Boolean(settings?.phone && settings?.confirmed_at);
  const status = phoneReady ? "active" : "waiting_on_production_phone";

  const { data: order, error } = await svc
    .from("orders")
    .insert({
      created_by: ctx.userId,
      assigned_to,
      product_name,
      quality,
      quantity,
      power_type,
      description,
      price,
      stage: 1,
      status,
      production_phone: phoneReady ? settings!.phone : null,
    })
    .select("id")
    .single();
  if (error || !order) return { error: error?.message ?? "Could not create the order." };

  await svc.from("order_stage_events").insert({
    order_id: order.id,
    from_stage: null,
    to_stage: 1,
    changed_by: ctx.userId,
  });

  if (phoneReady) {
    // WhatsApp is stubbed — this only logs the intended payload (spec §7).
    await createOrderGroup({
      orderId: order.id,
      productName: product_name,
      productionPhone: settings!.phone as string,
    });
  }

  await notify(svc, [assigned_to, ...(await headAdminIds(svc))], {
    type: "order",
    title: "New order dispatched",
    body: `${ctx.name} dispatched "${product_name}" to ${prod.full_name}${
      phoneReady ? "" : " — waiting on their phone number"
    }.`,
    entity_id: order.id,
  });

  revalidatePath("/dashboard/orders");
  redirect(`/dashboard/orders/${order.id}`);
}

/** The assigned production account advances an order one stage (spec §6). */
export async function advanceStage(orderId: string): Promise<Result> {
  const ctx = await requireSession();
  if (ctx.role !== "production") return { error: "Not permitted." };
  const svc = createServiceClient();

  const { data: order } = await svc
    .from("orders")
    .select(
      "id, assigned_to, created_by, stage, status, product_name, whatsapp_group_id, production_phone, stage_ready_at",
    )
    .eq("id", orderId)
    .single();

  if (!order) return { error: "Order not found." };
  if (order.assigned_to !== ctx.userId)
    return { error: "This order isn't assigned to you." };
  if (order.status !== "active")
    return { error: "This order is waiting on a production phone number." };
  if (order.stage >= MAX_STAGE) return { error: "This order is already delivered." };

  // Server-authoritative: reject an early advance even if a client is
  // tampered with or a stale page re-submits before its own timer shows zero.
  if (order.stage_ready_at && new Date(order.stage_ready_at).getTime() > Date.now()) {
    return { error: "The timer for this stage hasn't finished yet." };
  }

  const from = order.stage as number;
  const to = from + 1;
  const stageReadyAt =
    to < MAX_STAGE ? new Date(Date.now() + STAGE_TIMER_MS).toISOString() : null;

  const { error } = await svc
    .from("orders")
    .update({ stage: to, stage_ready_at: stageReadyAt })
    .eq("id", orderId);
  if (error) return { error: error.message };

  await svc.from("order_stage_events").insert({
    order_id: orderId,
    from_stage: from,
    to_stage: to,
    changed_by: ctx.userId,
  });

  // WhatsApp is stubbed — logs only (spec §7).
  await postStageUpdate({
    orderId,
    groupId: order.whatsapp_group_id,
    productionPhone: order.production_phone,
    text: `Order "${order.product_name}" moved to Stage ${to} — ${stageName(to)}.`,
  });

  await notify(svc, [order.created_by, ...(await headAdminIds(svc))], {
    type: "stage",
    title: `Stage ${to} — ${stageName(to)}`,
    body: `"${order.product_name}" is now at Stage ${to}: ${stageName(to)}.`,
    entity_id: orderId,
  });

  revalidatePath(`/dashboard/orders/${orderId}`);
  revalidatePath("/dashboard/orders");
  return { ok: `Advanced to Stage ${to} — ${stageName(to)}.` };
}
