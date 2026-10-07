"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireSession, requireRole } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { MAX_ORDER_ITEMS, STAGE_TIMER_MS, orderTitle, stageName } from "@/lib/orders";
import { createOrderGroup, postStageUpdate } from "@/lib/whatsapp";
import { titleOf } from "@/lib/data/order-title";

export type Result = { error?: string; ok?: string; id?: string };

type Svc = ReturnType<typeof createServiceClient>;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function headAdminIds(svc: Svc) {
  const { data } = await svc.from("profiles").select("id").eq("role", "head_admin");
  return (data ?? []).map((r) => r.id as string);
}

async function dispatcherIds(svc: Svc) {
  const { data } = await svc.from("profiles").select("id").eq("role", "dispatcher");
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

/** One product as the form sends it: parallel `name[]` fields, one per card. */
type ItemInput = {
  product_name: string;
  transformer_rating: string;
  quantity: number;
  price: number | null;
  description: string;
};

/** Marketing punches an order (1–20 products) to one or more chosen production members. */
export async function punchOrder(
  _prev: Result | null,
  fd: FormData,
): Promise<Result> {
  const ctx = await requireRole("marketing");

  const client_name = str(fd, "client_name");
  // browsers submit textarea line breaks as CRLF; store plain "\n"
  const ship_to = str(fd, "ship_to").replace(/\r\n?/g, "\n");
  const additionalRaw = str(fd, "additional_amount");
  const additional_amount = additionalRaw === "" ? null : Number(additionalRaw);
  const expected_delivery = str(fd, "expected_delivery") || null;
  const assignees = [
    ...new Set(fd.getAll("assigned_to").map((v) => String(v).trim())),
  ].filter(Boolean);

  const all = (k: string) => fd.getAll(k).map((v) => String(v).trim());
  const names = all("product_name[]");
  const ratings = all("transformer_rating[]");
  const quantities = all("quantity[]");
  const prices = all("price[]");
  const descriptions = all("description[]");
  const n = names.length;

  if (!client_name) return { error: "Client name is required." };
  if (n === 0) return { error: "Add at least one product." };
  if (n > MAX_ORDER_ITEMS) return { error: `An order can have at most ${MAX_ORDER_ITEMS} products.` };
  if ([ratings, quantities, prices, descriptions].some((a) => a.length !== n))
    return { error: "The form was incomplete. Please reload the page and try again." };

  const items: ItemInput[] = [];
  for (let i = 0; i < n; i++) {
    // Only name the product when there is more than one.
    const p = n > 1 ? `Product ${i + 1}: ` : "";
    const quantity = Number(quantities[i] || "1");
    const price = prices[i] === "" ? null : Number(prices[i]);
    if (!names[i]) return { error: `${p}Product name is required.` };
    if (!ratings[i]) return { error: `${p}Transformer rating is required.` };
    if (!Number.isInteger(quantity) || quantity < 1)
      return { error: `${p}Quantity must be a whole number of at least 1.` };
    if (price !== null && (!Number.isFinite(price) || price < 0))
      return { error: `${p}Price must be a positive number, or left blank.` };
    items.push({
      product_name: names[i],
      transformer_rating: ratings[i],
      quantity,
      price,
      description: descriptions[i],
    });
  }
  if (ship_to.length > 2000) return { error: "Ship To is too long (up to 2000 characters)." };
  if (additional_amount !== null && (!Number.isFinite(additional_amount) || additional_amount < 0))
    return { error: "Additional Amount must be a positive number, or left blank." };
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
      p_client_name: client_name,
      p_ship_to: ship_to,
      p_expected_delivery: expected_delivery,
      p_items: items,
      p_additional_amount: additional_amount,
      p_assignees: assignees,
    })
    .single<{ order_id: string; status: string }>();
  if (error || !data) {
    // create_order re-validates every product ("product 2: ...") — pass those through.
    const m = /^product (\d+): (.+)$/.exec(error?.message ?? "");
    return {
      error: error?.message.includes("production accounts")
        ? "One of the selected production members no longer exists."
        : error?.message.includes("real name")
          ? "Add your real name in Settings before punching orders."
          : m
            ? `${n > 1 ? `Product ${m[1]}: ` : ""}${m[2][0].toUpperCase()}${m[2].slice(1)}.`
            : "Could not create the order. Please try again.",
    };
  }
  const orderId = data.order_id;
  const active = data.status === "active";
  const title = orderTitle({ product_name: items[0].product_name, items });

  // Side effects the redirected page doesn't depend on: the (stubbed)
  // WhatsApp group and the notifications.
  after(async () => {
    const [{ data: phones }, heads] = await Promise.all([
      active
        ? svc.from("production_settings").select("phone").in("profile_id", assignees)
        : Promise.resolve({ data: [] as { phone: string | null }[] }),
      headAdminIds(svc),
    ]);
    // Stage 1 is the dispatchers' review: both of them get every new order.
    const dispatchers = await dispatcherIds(svc);
    await Promise.all([
      active
        ? createOrderGroup({
            orderId,
            productName: title,
            productionPhones: (phones ?? []).map((p) => p.phone as string),
          })
        : Promise.resolve(),
      notify(svc, [...assignees, ...heads, ...dispatchers], {
        type: "order",
        title: "New order punched",
        body: `${ctx.name} punched "${title}" for ${client_name}${
          active ? "" : " — waiting on a production phone number"
        }.`,
        entity_id: orderId,
      }),
    ]);
  });

  revalidatePath("/dashboard/orders");
  redirect(`/dashboard/orders/${orderId}`);
}

type StageMove = {
  outcome: string;
  stage: number | null;
  created_by: string;
  product_name: string;
  whatsapp_group_id: string | null;
  assignee_ids: string[] | null;
};

/** WhatsApp post + notifications after any stage change (not awaited by the caller). */
function announceStage(
  svc: Svc,
  orderId: string,
  r: StageMove,
  actorId: string,
  opts: { text?: (title: string, to: number) => string; extra?: string[] } = {},
) {
  const to = r.stage as number;
  after(async () => {
    const title = await titleOf(svc, orderId, r.product_name);
    await Promise.all([
      postStageUpdate({
        orderId,
        groupId: r.whatsapp_group_id,
        text: opts.text ? opts.text(title, to) : `Order "${title}" moved to Stage ${to} — ${stageName(to)}.`,
      }),
      (async () => {
        const recipients = [
          r.created_by,
          ...(await headAdminIds(svc)),
          ...(r.assignee_ids ?? []),
          ...(opts.extra ?? []),
        ].filter((id) => id !== actorId);
        await notify(svc, recipients, {
          type: "stage",
          title: `Stage ${to} — ${stageName(to)}`,
          body: opts.text ? opts.text(title, to) : `"${title}" is now at Stage ${to}: ${stageName(to)}.`,
          entity_id: orderId,
        });
      })(),
    ]);
  });
}

function revalidateOrder(orderId: string) {
  // The action's response carries the re-rendered page (revalidatePath), so
  // the client must NOT router.refresh() on top of it.
  revalidatePath(`/dashboard/orders/${orderId}`);
  revalidatePath("/dashboard/orders");
}

/**
 * An assigned production member advances the order one stage — from Stage 2
 * on (Stage 1 is the dispatchers' review) and once the stage timer has run
 * out. `fromStage` is the stage the member was looking at: if the order has
 * moved since (another assignee, a stale tab), nothing happens.
 */
export async function advanceStage(orderId: string, fromStage: number): Promise<Result> {
  const ctx = await requireSession();
  if (!ctx.can("orders.advanceStage")) return { error: "Not permitted." };
  if (!UUID.test(orderId) || !Number.isInteger(fromStage)) return { error: "Order not found." };
  const svc = createServiceClient();

  // One round trip: checks, stage move and history row in one transaction
  // under a row lock (advance_order_stage, migrations 0015 / 0023).
  const { data: r, error } = await svc
    .rpc("advance_order_stage", {
      p_order_id: orderId,
      p_actor: ctx.userId,
      p_from_stage: fromStage,
      p_timer_seconds: Math.round(STAGE_TIMER_MS / 1000),
    })
    .single<StageMove>();
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
    case "awaiting_dispatch":
      return { error: "This order is still in Dispatch review. A dispatcher has to dispatch it first." };
    case "timer":
      return { error: "The timer for this stage hasn't finished yet." };
    case "stale":
      revalidatePath(`/dashboard/orders/${orderId}`);
      return { error: `This order was already moved to Stage ${r.stage} — ${stageName(r.stage ?? 1)}.` };
    default:
      return { error: "Could not advance the order. Please try again." };
  }

  announceStage(svc, orderId, r, ctx.userId);
  revalidateOrder(orderId);
  const to = r.stage as number;
  return { ok: `Advanced to Stage ${to} — ${stageName(to)}.` };
}

/**
 * A dispatcher opened a Stage 1 order: "Start" becomes "Verification in
 * progress" (once — start_order_review only marks it the first time).
 */
export async function startReview(orderId: string): Promise<void> {
  const ctx = await requireSession();
  if (!ctx.can("orders.dispatchReview") || !UUID.test(orderId)) return;
  const svc = createServiceClient();
  const { data } = await svc.rpc("start_order_review", { p_order_id: orderId, p_actor: ctx.userId });
  if (data === true) revalidateOrder(orderId);
}

/**
 * Dispatcher: "Dispatch to production" — Stage 1 -> Stage 2. Only once every
 * assigned production member has a phone linked (status active). No timer;
 * production may start Stage 2 -> 3 straight away. If the other dispatcher
 * got there first, nothing happens.
 */
export async function dispatchToProduction(orderId: string): Promise<Result> {
  const ctx = await requireSession();
  if (!ctx.can("orders.dispatchReview")) return { error: "Not permitted." };
  if (!UUID.test(orderId)) return { error: "Order not found." };
  const svc = createServiceClient();

  const { data: r, error } = await svc
    .rpc("dispatch_order", { p_order_id: orderId, p_actor: ctx.userId })
    .single<StageMove & { by_label: string | null }>();
  if (error || !r) return { error: "Could not dispatch the order. Please try again." };

  switch (r.outcome) {
    case "ok":
      break;
    case "not_found":
      return { error: "Order not found." };
    case "not_permitted":
      return { error: "Not permitted." };
    case "waiting":
      return {
        error: "This order can't be dispatched yet: an assigned production member hasn't linked a phone number.",
      };
    case "already":
      revalidateOrder(orderId);
      return {
        error: `This order has already left Dispatch review${r.by_label ? ` (dispatched by ${r.by_label})` : ""}.`,
      };
    default:
      return { error: "Could not dispatch the order. Please try again." };
  }

  announceStage(svc, orderId, r, ctx.userId, {
    extra: await dispatcherIds(svc),
    text: (title) => `"${title}" was dispatched to production by ${ctx.name} and is now at Stage 2 — ${stageName(2)}.`,
  });
  revalidateOrder(orderId);
  return { ok: `Dispatched to production — now at Stage 2 — ${stageName(2)}.` };
}

/**
 * Admin / head_admin: move the order to ANY stage (next, back, or skipping)
 * — no timer, no dispatch step, no status check (admin_set_order_stage,
 * 0023). The UI asks them to confirm every move first. A move to Stage 2-4
 * starts production's timer for their next advance, as in 0021.
 */
export async function setStage(orderId: string, fromStage: number, toStage: number): Promise<Result> {
  const ctx = await requireSession();
  if (!ctx.can("orders.overrideStage")) return { error: "Not permitted." };
  if (!UUID.test(orderId) || !Number.isInteger(fromStage) || !Number.isInteger(toStage))
    return { error: "Order not found." };
  const svc = createServiceClient();

  const { data: r, error } = await svc
    .rpc("admin_set_order_stage", {
      p_order_id: orderId,
      p_actor: ctx.userId,
      p_from_stage: fromStage,
      p_to_stage: toStage,
      p_timer_seconds: Math.round(STAGE_TIMER_MS / 1000),
    })
    .single<StageMove>();
  if (error || !r) return { error: "Could not move the order. Please try again." };

  switch (r.outcome) {
    case "ok":
      break;
    case "not_found":
      return { error: "Order not found." };
    case "not_permitted":
      return { error: "Not permitted." };
    case "invalid":
      return { error: "Choose a different stage." };
    case "stale":
      revalidatePath(`/dashboard/orders/${orderId}`);
      return { error: `This order was already moved to Stage ${r.stage} — ${stageName(r.stage ?? 1)}.` };
    default:
      return { error: "Could not move the order. Please try again." };
  }

  // Back in Dispatch review: the dispatchers need to know.
  announceStage(svc, orderId, r, ctx.userId, { extra: toStage === 1 ? await dispatcherIds(svc) : [] });
  revalidateOrder(orderId);
  return { ok: `Moved to Stage ${toStage} — ${stageName(toStage)}.` };
}
