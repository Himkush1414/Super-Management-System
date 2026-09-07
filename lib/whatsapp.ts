import "server-only";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  WHATSAPP INTEGRATION — STUB ONLY (spec §7)
 * ─────────────────────────────────────────────────────────────────────────────
 *  There is NO WhatsApp Business API account yet, and setting one up is outside
 *  what code alone can do. Nothing here talks to WhatsApp. Every function below
 *  only LOGS the payload it would have sent and returns a "not configured"
 *  result. Callers must treat that result as "message NOT delivered".
 *
 *  When a real WhatsApp Business API is available, replace the bodies marked
 *  `// TODO(whatsapp):` with the actual client calls and flip WHATSAPP_ENABLED.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const WHATSAPP_ENABLED = false;

export type WhatsAppResult =
  | { ok: true; groupId: string }
  | { ok: false; reason: "not_configured" };

/** Would create a WhatsApp group for an order with the production account's phone. */
export async function createOrderGroup(input: {
  orderId: string;
  productName: string;
  productionPhone: string;
}): Promise<WhatsAppResult> {
  // TODO(whatsapp): call WhatsApp Business API — create group, add productionPhone,
  // return the real group id.
  console.warn(
    "[whatsapp:STUB] would create group for order %s → invite %s (%s). Not sent — no WhatsApp API configured.",
    input.orderId,
    input.productionPhone,
    input.productName,
  );
  return { ok: false, reason: "not_configured" };
}

/** Would post a stage-change message into the order's WhatsApp group. */
export async function postStageUpdate(input: {
  orderId: string;
  groupId: string | null;
  productionPhone: string | null;
  text: string;
}): Promise<WhatsAppResult> {
  // TODO(whatsapp): call WhatsApp Business API — send `text` to `groupId`.
  console.warn(
    "[whatsapp:STUB] would post to group %s (order %s, %s): %j. Not sent — no WhatsApp API configured.",
    input.groupId ?? "—",
    input.orderId,
    input.productionPhone ?? "—",
    input.text,
  );
  return { ok: false, reason: "not_configured" };
}
