"use client";

import { useSyncExternalStore } from "react";
import type { InvHistory } from "@/lib/inventory/types";

/**
 * Two small client stores for the Inventory screens. Both live for the tab
 * (module scope), hold only what this signed-in browser itself read or
 * saved, and are cleared on sign-out by the full page load that follows.
 */

// ── history: one fetch per product, shared, invalidated after a save ─────

const history = new Map<string, { at: number; p: Promise<InvHistory> }>();
const HISTORY_TTL_MS = 60_000;

async function fetchHistory(id: string): Promise<InvHistory> {
  const res = await fetch(`/dashboard/inventory/history?id=${encodeURIComponent(id)}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  // signed out meanwhile: the proxy answers with the login page (HTML)
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) {
    throw new Error(res.status === 403 ? "Not permitted." : "The history didn't load. Please try again.");
  }
  return (await res.json()) as InvHistory;
}

/** The product's history: cached for a minute, one request in flight at most. */
export function loadHistory(id: string): Promise<InvHistory> {
  const hit = history.get(id);
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.p;
  const p = fetchHistory(id);
  history.set(id, { at: Date.now(), p });
  p.catch(() => history.delete(id)); // a failed read is retried next time
  return p;
}

/** Start loading as the finger touches the row: the panel then opens onto data. */
export function prefetchHistory(id: string) {
  void loadHistory(id).catch(() => {});
}

export function invalidateHistory(id: string) {
  history.delete(id);
}

// ── saved figures: shown until the server's data includes the entry ──────

export type Saved = { received: bigint; issued: bigint; balance: bigint; seq: number };
const saved = new Map<string, Saved>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

/**
 * Record figures the database just confirmed for a product, tagged with the
 * ledger id of the entry that produced them. They're shown instead of the
 * page data's figures until the page data includes that entry
 * (data.ledger_seq ≥ seq), so a cached page opened again later never shows
 * the stock from before the save.
 */
export function rememberSaved(productId: string, s: Saved) {
  const cur = saved.get(productId);
  if (cur && cur.seq >= s.seq) return; // an older answer arriving late never wins
  saved.set(productId, s);
  emit();
}

/** The saved figures newer than the page data, by product. */
export function savedNewerThan(ledgerSeq: number): Map<string, Saved> {
  const out = new Map<string, Saved>();
  for (const [id, s] of saved) {
    if (s.seq > ledgerSeq) out.set(id, s);
  }
  return out;
}

/** Forget figures the page data already includes (keeps the map small). */
export function pruneSaved(ledgerSeq: number) {
  let changed = false;
  for (const [id, s] of saved) {
    if (s.seq <= ledgerSeq) {
      saved.delete(id);
      changed = true;
    }
  }
  if (changed) emit();
}

export function useSavedVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
}
