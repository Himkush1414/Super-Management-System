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
  | { ok: true; message?: string; balanceAfter?: string; id?: string | number; belowMin?: boolean; minStock?: string | null; changed?: number }
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
  if (r.status === "ok") {
    const x = r as InvWriteResult & { below_min?: boolean; min_stock?: string | null; changed?: number | boolean };
    return { ok: true, message: ok, balanceAfter: r.balance_after, id: r.id, belowMin: x.below_min, minStock: x.min_stock ?? null, changed: typeof x.changed === "number" ? x.changed : undefined };
  }
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

/** The optional details of an entry (0030). Receive: party, challan, bill no, bill date. Issue: job no, rating, no. of jobs. */
export type EntryDetails = {
  party?: string;
  challanNo?: string;
  billNo?: string;
  billDate?: string;
  jobNo?: string;
  rating?: string;
  noOfJobs?: string;
};

const txt = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) || null : null);

/** Receive or issue stock. `key` is made once per entry, so a retry or a double tap records once. */
export async function recordEntry(input: {
  productId: string;
  kind: "receive" | "issue";
  qty: string;
  date: string;
  note: string;
  key: string;
  details?: EntryDetails;
}): Promise<ActionResult> {
  if (!UUID.test(input.productId) || !KEY.test(input.key)) return { ok: false, error: "Product not found." };
  if (input.kind !== "receive" && input.kind !== "issue") return { ok: false, error: "Choose Receive or Issue." };
  const q = checkQty(input.qty);
  if (!q.ok) return { ok: false, error: q.message };
  if (!DAY.test(input.date)) return { ok: false, error: "Choose a date." };
  const d = input.details ?? {};
  const receive = input.kind === "receive";
  const billDate = receive && typeof d.billDate === "string" && d.billDate ? d.billDate : null;
  if (billDate && !DAY.test(billDate)) return { ok: false, error: "Choose a real bill date." };
  // only the details that belong to this kind are sent; the database checks again
  return ledgerWrite("inv_record_entry", {
    p_product_id: input.productId,
    p_kind: input.kind,
    p_qty: qtyToText(q.qty),
    p_entry_date: input.date,
    p_note: input.note.trim().slice(0, 300) || null,
    p_idempotency_key: input.key,
    p_party: receive ? txt(d.party, 120) : null,
    p_challan_no: receive ? txt(d.challanNo, 60) : null,
    p_bill_no: receive ? txt(d.billNo, 60) : null,
    p_bill_date: billDate,
    p_job_no: receive ? null : txt(d.jobNo, 60),
    p_rating: receive ? null : txt(d.rating, 60),
    p_no_of_jobs: receive ? null : txt(d.noOfJobs, 20),
  }, receive ? "Receipt saved." : "Issue saved.");
}

/** Reverse an entry of this month (a new opposite entry; nothing is edited or deleted). */
export async function reverseEntry(input: { entryId: number; note: string; key: string }): Promise<ActionResult> {
  if (!Number.isSafeInteger(input.entryId) || input.entryId <= 0 || !KEY.test(input.key)) {
    return { ok: false, error: "Entry not found." };
  }
  // inv_reverse_entry (0030): the reversal carries the original's details
  return ledgerWrite("inv_reverse_entry", {
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

/** A minimum-stock text: "" = no minimum; else ≥ 0 with at most 3 decimals. */
function minText(v: string | undefined): { ok: true; value: string | null } | { ok: false } {
  if (v === undefined || !String(v).trim()) return { ok: true, value: null };
  const q = parseQty(String(v));
  if (q === null || q < BigInt(0)) return { ok: false };
  return { ok: true, value: qtyToText(q) };
}

/** Set (or clear with "") one product's minimum stock. */
export async function setMinStock(productId: string, minStock: string): Promise<ActionResult> {
  if (!(await manager())) return { ok: false, error: "Not permitted." };
  if (!UUID.test(productId)) return { ok: false, error: "Product not found." };
  const min = minText(minStock);
  if (!min.ok) return { ok: false, error: "0 or more, with at most 3 decimals." };
  // no page re-render in the answer: the list keeps its own state, and the
  // Inventory page picks the new minimum up (stores.ts) — a row save stays tiny
  return asResult(await call("inv_set_min_stock", { p_product_id: productId, p_min_stock: min.value }), "Minimum saved.");
}

/** The same minimum for several products (the settings' "set for all filtered"). */
export async function setMinStockBulk(productIds: string[], minStock: string): Promise<ActionResult> {
  if (!(await manager())) return { ok: false, error: "Not permitted." };
  if (!Array.isArray(productIds) || !productIds.length || productIds.length > 10000 || !productIds.every((id) => UUID.test(id))) {
    return { ok: false, error: "No products chosen." };
  }
  const min = minText(minStock);
  if (!min.ok) return { ok: false, error: "0 or more, with at most 3 decimals." };
  const res = asResult(await call("inv_set_min_stock_bulk", { p_product_ids: productIds, p_min_stock: min.value }), "Minimums saved.");
  if (res.ok) {
    done();
    revalidatePath("/dashboard/inventory-settings");
  }
  return res;
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
  minStock?: string;
}): Promise<ActionResult> {
  if (!(await manager())) return { ok: false, error: "Not permitted." };
  const rate = rateText(input.rate);
  if (!rate.ok) return { ok: false, error: "The rate must be a number with at most 2 decimals." };
  const opening = input.openingQty.trim() ? parseQty(input.openingQty) : BigInt(0);
  if (opening === null || opening < BigInt(0)) {
    return { ok: false, error: "The opening balance must be 0 or more, with at most 3 decimals." };
  }
  const min = minText(input.minStock);
  if (!min.ok) return { ok: false, error: "The minimum stock must be 0 or more, with at most 3 decimals." };
  const r = await call("inv_add_product_v2", {
    p_serial_no: input.serialNo.trim(),
    p_description: input.description.trim(),
    p_specification: input.specification.trim(),
    p_rate: rate.value,
    p_opening_qty: qtyToText(opening),
    p_custom: cleanCustom(input.custom),
    p_min_stock: min.value,
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
  minStock?: string;
}): Promise<ActionResult> {
  if (!(await manager())) return { ok: false, error: "Not permitted." };
  if (!UUID.test(input.productId)) return { ok: false, error: "Product not found." };
  const rate = rateText(input.rate);
  if (!rate.ok) return { ok: false, error: "The rate must be a number with at most 2 decimals." };
  const min = minText(input.minStock);
  if (!min.ok) return { ok: false, error: "The minimum stock must be 0 or more, with at most 3 decimals." };
  const r = await call("inv_update_product_v2", {
    p_product_id: input.productId,
    p_description: input.description.trim(),
    p_specification: input.specification.trim(),
    p_rate: rate.value,
    p_custom: cleanCustom(input.custom),
    p_min_stock: min.value,
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
