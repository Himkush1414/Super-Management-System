"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { perf } from "@/lib/perf";
import { checkQty, parsePaise, parseQty, paiseToText, qtyToText } from "@/lib/inventory/numbers";
import { getInventoryHistory } from "@/lib/inventory/data";
import type { InvHistory, InvWriteResult } from "@/lib/inventory/types";

/**
 * Inventory server actions. Each one re-checks the permission on the server
 * (the UI is never the gate) and calls a role-checked RPC with the caller's
 * OWN session, so Postgres checks the role again (inv_can_manage) before
 * anything is written. Expected refusals come back as a message, never as a
 * thrown error.
 */

export type ActionResult =
  /** id: the new ledger entry's id (receive / issue / reverse) or the new product's id */
  | { ok: true; message?: string; balanceAfter?: string; id?: string | number }
  | { ok: false; error: string; balance?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9:_-]{8,120}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FAILED = "Could not save. Nothing was changed. Please try again.";

async function manager() {
  const ctx = await requireSession({ inventory: true });
  return ctx.can("inventory.manage") ? ctx : null;
}

function asResult(r: InvWriteResult | null, ok: string): ActionResult {
  if (!r) return { ok: false, error: FAILED };
  if (r.status === "ok") return { ok: true, message: ok, balanceAfter: r.balance_after, id: r.id };
  // the same request again (double tap, retried network): it was saved once
  if (r.status === "duplicate" && r.balance_after !== undefined) {
    return { ok: true, message: "Already saved.", balanceAfter: r.balance_after, id: r.id };
  }
  return { ok: false, error: r.message ?? FAILED, balance: r.balance };
}

/**
 * A ledger write (receive / issue / reverse): the session check and the RPC
 * run in PARALLEL, one round trip instead of two. That's safe because the
 * RPC runs with the caller's own session and checks the role itself
 * (inv_can_manage) before anything is written: for anyone but the inventory
 * account it writes nothing. The answer is only used once the session check
 * has passed too. No page re-render is sent back: the screen shows the
 * figures the database returns (ledger id + balance), which keeps a save
 * to one small response.
 */
async function ledgerWrite(fn: string, args: Record<string, unknown>, ok: string): Promise<ActionResult> {
  const rpcP = call(fn, args);
  const ctx = await requireSession({ inventory: true });
  const r = await rpcP;
  if (!ctx.can("inventory.manage")) return { ok: false, error: "Not permitted." };
  return asResult(r, ok);
}

async function call(fn: string, args: Record<string, unknown>): Promise<InvWriteResult | null> {
  const pf = perf(`action.${fn}`);
  const supabase = await createClient();
  const { data, error } = await pf.time(`rpc.${fn}`, supabase.rpc(fn, args));
  pf.end({ ok: !error, status: (data as InvWriteResult | null)?.status });
  if (error) {
    console.error(JSON.stringify({ inventoryAction: fn, code: error.code, reason: error.message?.slice(0, 160) }));
    return null;
  }
  return data as InvWriteResult;
}

const done = () => revalidatePath("/dashboard/inventory");

/** Receive or issue stock. `key` is made once per form, so a retry or a double tap records once. */
export async function recordEntry(input: {
  productId: string;
  kind: "receive" | "issue";
  qty: string;
  date: string;
  note: string;
  key: string;
}): Promise<ActionResult> {
  if (!UUID.test(input.productId) || !KEY.test(input.key)) return { ok: false, error: "Product not found." };
  if (input.kind !== "receive" && input.kind !== "issue") return { ok: false, error: "Choose Receive or Issue." };
  const q = checkQty(input.qty);
  if (!q.ok) return { ok: false, error: q.message };
  if (!DAY.test(input.date)) return { ok: false, error: "Choose a date." };
  return ledgerWrite("inv_record_transaction", {
    p_product_id: input.productId,
    p_kind: input.kind,
    p_qty: qtyToText(q.qty),
    p_entry_date: input.date,
    p_note: input.note.trim().slice(0, 300) || null,
    p_idempotency_key: input.key,
  }, input.kind === "receive" ? "Receipt saved." : "Issue saved.");
}

/** Reverse an entry of this month (a new opposite entry; nothing is edited or deleted). */
export async function reverseEntry(input: { entryId: number; note: string; key: string }): Promise<ActionResult> {
  if (!Number.isSafeInteger(input.entryId) || input.entryId <= 0 || !KEY.test(input.key)) {
    return { ok: false, error: "Entry not found." };
  }
  return ledgerWrite("inv_reverse_transaction", {
    p_transaction_id: input.entryId,
    p_note: input.note.trim().slice(0, 300) || null,
    p_idempotency_key: input.key,
  }, "Entry reversed.");
}

function cleanCustom(custom: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(custom ?? {})) {
    if (UUID.test(k) && typeof v === "string") out[k] = v.trim().slice(0, 200);
  }
  return out;
}

function rateText(rate: string): { ok: true; value: string | null } | { ok: false } {
  if (!rate.trim()) return { ok: true, value: null };
  const p = parsePaise(rate);
  if (p === null || p < BigInt(0)) return { ok: false };
  return { ok: true, value: paiseToText(p) };
}

export async function addProduct(input: {
  serialNo: string;
  description: string;
  specification: string;
  rate: string;
  openingQty: string;
  custom: Record<string, string>;
}): Promise<ActionResult> {
  if (!(await manager())) return { ok: false, error: "Not permitted." };
  const rate = rateText(input.rate);
  if (!rate.ok) return { ok: false, error: "The rate must be a number with at most 2 decimals." };
  const opening = input.openingQty.trim() ? parseQty(input.openingQty) : BigInt(0);
  if (opening === null || opening < BigInt(0)) {
    return { ok: false, error: "The opening balance must be 0 or more, with at most 3 decimals." };
  }
  const r = await call("inv_add_product", {
    p_serial_no: input.serialNo.trim(),
    p_description: input.description.trim(),
    p_specification: input.specification.trim(),
    p_rate: rate.value,
    p_opening_qty: qtyToText(opening),
    p_custom: cleanCustom(input.custom),
  });
  const res = asResult(r, "Product added.");
  if (res.ok) done();
  return res;
}

export async function updateProduct(input: {
  productId: string;
  description: string;
  specification: string;
  rate: string;
  custom: Record<string, string>;
}): Promise<ActionResult> {
  if (!(await manager())) return { ok: false, error: "Not permitted." };
  if (!UUID.test(input.productId)) return { ok: false, error: "Product not found." };
  const rate = rateText(input.rate);
  if (!rate.ok) return { ok: false, error: "The rate must be a number with at most 2 decimals." };
  const r = await call("inv_update_product", {
    p_product_id: input.productId,
    p_description: input.description.trim(),
    p_specification: input.specification.trim(),
    p_rate: rate.value,
    p_custom: cleanCustom(input.custom),
  });
  const res = asResult(r, "Details saved.");
  if (res.ok) done();
  return res;
}

/** Archive (never delete) or restore a product. */
export async function setProductActive(productId: string, active: boolean): Promise<ActionResult> {
  if (!(await manager())) return { ok: false, error: "Not permitted." };
  if (!UUID.test(productId) || typeof active !== "boolean") return { ok: false, error: "Product not found." };
  const res = asResult(await call("inv_set_product_active", { p_product_id: productId, p_active: active }),
    active ? "Product restored." : "Product archived.");
  if (res.ok) done();
  return res;
}

export async function saveInventorySettings(input: { personName: string; phone: string }): Promise<ActionResult> {
  if (!(await manager())) return { ok: false, error: "Not permitted." };
  const res = asResult(await call("inv_save_settings", {
    p_person_name: String(input.personName ?? "").trim().slice(0, 80),
    p_phone: String(input.phone ?? "").trim().slice(0, 25),
  }), "Settings saved.");
  if (res.ok) {
    done();
    revalidatePath("/dashboard/inventory-settings");
  }
  return res;
}

export async function addColumn(input: { label: string; dataType: "text" | "number" | "date" }): Promise<ActionResult> {
  if (!(await manager())) return { ok: false, error: "Not permitted." };
  const res = asResult(await call("inv_add_column", { p_label: String(input.label ?? "").trim(), p_data_type: input.dataType }),
    "Column added.");
  if (res.ok) {
    done();
    revalidatePath("/dashboard/inventory-settings");
  }
  return res;
}

export async function updateColumn(input: { columnId: string; label?: string; visible?: boolean }): Promise<ActionResult> {
  if (!(await manager())) return { ok: false, error: "Not permitted." };
  if (!UUID.test(input.columnId)) return { ok: false, error: "Column not found." };
  const res = asResult(await call("inv_update_column", {
    p_column_id: input.columnId,
    p_label: input.label?.trim() || null,
    p_visible: typeof input.visible === "boolean" ? input.visible : null,
  }), "Column saved.");
  if (res.ok) {
    done();
    revalidatePath("/dashboard/inventory-settings");
  }
  return res;
}

export async function reorderColumns(columnIds: string[]): Promise<ActionResult> {
  if (!(await manager())) return { ok: false, error: "Not permitted." };
  if (!Array.isArray(columnIds) || columnIds.length > 50 || !columnIds.every((id) => UUID.test(id))) {
    return { ok: false, error: "Column not found." };
  }
  const res = asResult(await call("inv_reorder_columns", { p_column_ids: columnIds }), "Order saved.");
  if (res.ok) {
    done();
    revalidatePath("/dashboard/inventory-settings");
  }
  return res;
}

export async function setColumnArchived(columnId: string, archived: boolean): Promise<ActionResult> {
  if (!(await manager())) return { ok: false, error: "Not permitted." };
  if (!UUID.test(columnId) || typeof archived !== "boolean") return { ok: false, error: "Column not found." };
  const res = asResult(await call("inv_set_column_archived", { p_column_id: columnId, p_archived: archived }),
    archived ? "Column archived." : "Column restored.");
  if (res.ok) {
    done();
    revalidatePath("/dashboard/inventory-settings");
  }
  return res;
}

/** A product's recent entries (inventory and admin tier). */
export async function loadHistory(productId: string): Promise<{ ok: true; history: InvHistory } | { ok: false; error: string }> {
  const ctx = await requireSession({ inventory: true });
  if (!ctx.can("inventory.view")) return { ok: false, error: "Not permitted." };
  if (!UUID.test(productId)) return { ok: false, error: "Product not found." };
  try {
    return { ok: true, history: await getInventoryHistory(productId) };
  } catch {
    return { ok: false, error: "The history didn't load. Please try again." };
  }
}
