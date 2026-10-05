"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireSession, requireRole } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { STAGE_TIMER_MS, stageName } from "@/lib/orders";
import { createOrderGroup, postStageUpdate } from "@/lib/whatsapp";

export type Result = { error?: string; ok?: string; id?: string };

type Svc = ReturnType<typeof createServiceClient>;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function headAdminIds(svc: Svc) {
  const { data } = await svc.from("profiles").select("id").eq("role", "head_admin");
  return (data ?? []).map((r) => r.id as string);
}

async function notify(
  svc: Svc,
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

function isRealDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** Marketing dispatches an order to one or more chosen production members. */
export async function dispatchOrder(
  _prev: Result | null,
  fd: FormData,
): Promise<Result> {
  const ctx = await requireRole("marketing");

  const product_name = str(fd, "product_name");
  const client_name = str(fd, "client_name");
  const transformer_rating = str(fd, "transformer_rating");
  const description = str(fd, "description");
  const quantity = Number(str(fd, "quantity") || "1");
  const priceRaw = str(fd, "price");
  const price = priceRaw === "" ? null : Number(priceRaw);
  const expected_delivery = str(fd, "expected_delivery") || null;
  const assignees = [
    ...new Set(fd.getAll("assigned_to").map((v) => String(v).trim())),
  ].filter(Boolean);

  if (!product_name) return { error: "Product name is required." };
  if (!client_name) return { error: "Client name is required." };
  if (!transformer_rating) return { error: "Transformer rating is required." };
  if (!Number.isInteger(quantity) || quantity < 1)
    return { error: "Quantity must be a whole number of at least 1." };
  if (price !== null && (!Number.isFinite(price) || price < 0))
    return { error: "Order value must be a positive number, or left blank." };
  if (expected_delivery && (!ISO_DATE.test(expected_delivery) || !isRealDate(expected_delivery)))
    return { error: "Expected delivery must be a real date, entered as DD/MM/YYYY." };
  if (assignees.length === 0)
    return { error: "Choose at least one production member to send this to." };
  if (!assignees.every((id) => UUID.test(id)))
    return { error: "That production member no longer exists." };

  const svc = createServiceClient();
  const { data, error } = await svc
    .rpc("create_order", {
      p_created_by: ctx.userId,
      p_product_name: product_name,
      p_client_name: client_name,
      p_transformer_rating: transformer_rating,
      p_quantity: quantity,
      p_price: price,
      p_expected_delivery: expected_delivery,
      p_description: description,
      p_assignees: assignees,
    })
    .single<{ order_id: string; status: string }>();
  if (error || !data) {
    return {
      error: error?.message.includes("production accounts")
        ? "One of the selected production members no longer exists."
        : error?.message.includes("real name")
          ? "Add your real name in Settings before dispatching orders."
          : "Could not create the order. Please try again.",
    };
  }
  const orderId = data.order_id;
  const active = data.status === "active";

  // Side effects the redirected page doesn't depend on: the (stubbed)
  // WhatsApp group and the notifications.
  after(async () => {
    const [{ data: phones }, heads] = await Promise.all([
      active
        ? svc.from("production_settings").select("phone").in("profile_id", assignees)
        : Promise.resolve({ data: [] as { phone: string | null }[] }),
      headAdminIds(svc),
    ]);
    await Promise.all([
      active
        ? createOrderGroup({
            orderId,
            productName: product_name,
            productionPhones: (phones ?? []).map((p) => p.phone as string),
          })
        : Promise.resolve(),
      notify(svc, [...assignees, ...heads], {
        type: "order",
        title: "New order dispatched",
        body: `${ctx.name} dispatched "${product_name}" for ${client_name}${
          active ? "" : " — waiting on a production phone number"
        }.`,
        entity_id: orderId,
      }),
    ]);
  });

  revalidatePath("/dashboard/orders");
  redirect(`/dashboard/orders/${orderId}`);
}

/**
 * Any production member assigned to the order advances it one stage.
 * `fromStage` is the stage the member was looking at: if the order has moved
 * since (another assignee, a stale tab), nothing happens.
 */
export async function advanceStage(orderId: string, fromStage: number): Promise<Result> {
  const ctx = await requireSession();
  if (ctx.role !== "production") return { error: "Not permitted." };
  if (!UUID.test(orderId) || !Number.isInteger(fromStage)) return { error: "Order not found." };
  const svc = createServiceClient();

  // One round trip: checks, stage move and history row in one transaction
  // under a row lock (advance_order_stage, migration 0015).
  const { data: r, error } = await svc
    .rpc("advance_order_stage", {
      p_order_id: orderId,
      p_actor: ctx.userId,
      p_from_stage: fromStage,
      p_timer_seconds: Math.round(STAGE_TIMER_MS / 1000),
    })
    .single<{
      outcome: string;
      stage: number | null;
      created_by: string;
      product_name: string;
      whatsapp_group_id: string | null;
      assignee_ids: string[] | null;
    }>();
  if (error || !r) return { error: "Could not advance the order. Please try again." };

  switch (r.outcome) {
    case "ok":
      break;
    case "not_found":
      return { error: "Order not found." };
    case "not_assigned":
      return { error: "This order isn't assigned to you." };
    case "waiting":
      return { error: "This order is waiting on a production phone number." };
    case "delivered":
      return { error: "This order is already at the final stage." };
    case "timer":
      return { error: "The timer for this stage hasn't finished yet." };
    case "stale":
      revalidatePath(`/dashboard/orders/${orderId}`);
      return { error: `This order was already moved to Stage ${r.stage} — ${stageName(r.stage ?? 1)}.` };
    default:
      return { error: "Could not advance the order. Please try again." };
  }

  const to = r.stage as number;
  // The (stubbed) WhatsApp post and the notifications are side effects the
  // caller doesn't need to wait on.
  after(async () => {
    await Promise.all([
      postStageUpdate({
        orderId,
        groupId: r.whatsapp_group_id,
        text: `Order "${r.product_name}" moved to Stage ${to} — ${stageName(to)}.`,
      }),
      (async () => {
        const recipients = [r.created_by, ...(await headAdminIds(svc)), ...(r.assignee_ids ?? [])].filter(
          (id) => id !== ctx.userId,
        );
        await notify(svc, recipients, {
          type: "stage",
          title: `Stage ${to} — ${stageName(to)}`,
          body: `"${r.product_name}" is now at Stage ${to}: ${stageName(to)}.`,
          entity_id: orderId,
        });
      })(),
    ]);
  });

  // The action's response carries the re-rendered page (revalidatePath), so
  // the client must NOT router.refresh() on top of it.
  revalidatePath(`/dashboard/orders/${orderId}`);
  revalidatePath("/dashboard/orders");
  return { ok: `Advanced to Stage ${to} — ${stageName(to)}.` };
}
