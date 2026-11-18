"use client";

import { useDeferredValue, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, ArchiveRestore, Search, Trash2, X, History, PackageSearch } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { buildIndex, search } from "@/lib/inventory/search";
import { formatQty, parseQty } from "@/lib/inventory/numbers";
import { deleteArchivedProduct, restoreProducts } from "@/lib/inventory/actions";
import type { InvArchivedProduct } from "@/lib/inventory/data";
import { cn, formatDateTime } from "@/lib/utils";
import { Field, FieldLabel, Highlight } from "./bits";
import { Sheet } from "./Sheet";
import { ToastProvider, useToast } from "./Toast";

type Props = { products: InvArchivedProduct[]; deleted: number; canManage: boolean };

/**
 * The Archive tab (0032). Archived products stay out of the main list, the
 * totals and the alerts (as before); here they can be found, restored (one
 * or many) and, for a product with no history at all, deleted for good.
 */
export function ArchivePage(props: Props) {
  return (
    <ToastProvider>
      <ArchiveInner {...props} />
    </ToastProvider>
  );
}

function ArchiveInner({ products, deleted, canManage }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [restoring, setRestoring] = useState<InvArchivedProduct[] | null>(null);
  const [deleting, setDeleting] = useState<InvArchivedProduct | null>(null);
  // rows done on this screen (restored / deleted) leave the list at once; the page reads again behind
  const [gone, setGone] = useState<Set<string>>(new Set());

  const pool = useMemo(() => products.filter((p) => !gone.has(p.id)), [products, gone]);
  const index = useMemo(() => buildIndex(pool, (p) => [p.serial_no, p.description, p.specification]), [pool]);
  const shown = useMemo(() => (deferred.trim() ? search(index, deferred).map((i) => pool[i]) : pool), [index, deferred, pool]);
  const pickedShown = shown.filter((p) => picked.has(p.id));
  // 1280 px and up: one column template for the headings and every row (the last column is fixed, so they line up)
  const cols = `1rem minmax(5.5rem,0.7fr) minmax(0,2fr) 9.5rem 6rem ${canManage ? "19.5rem" : "7rem"}`;
  const allShownPicked = shown.length > 0 && pickedShown.length === shown.length;

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <div className="mb-5">
        <p className="nr-section-label">Store</p>
        <h1 className="text-[1.5rem] font-semibold tracking-[-0.025em]">Archive</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-text-secondary">
          Archived products: out of the stock list, the totals and the alerts. Their history stays.
          {canManage ? " Restore brings one back with its history; nothing in the ledger changes." : " Read only."}
        </p>
      </div>

      <div className="sticky top-14 z-20 -mx-4 border-b border-border bg-bg/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-xl">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search serial, material, specification…"
              aria-label="Search archived products"
              autoComplete="off"
              spellCheck={false}
              className="h-11 w-full rounded-xl border border-border-strong bg-panel pl-10 pr-10 text-[15px] text-text placeholder:text-text-tertiary focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 md:text-sm [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="nr-interactive absolute right-1 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-text-tertiary hover:bg-overlay/[0.06] hover:text-text"
              >
                <X size={15} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <p className="tnum mr-auto whitespace-nowrap text-[12.5px] text-text-tertiary sm:mr-1" aria-live="polite" data-inv-archive-count>
              {deferred.trim() ? `${shown.length} of ${pool.length}` : `${pool.length}`} archived
            </p>
            {canManage && shown.length > 0 && (
              <label className="nr-interactive inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-[13px] font-medium text-text-secondary hover:text-text md:h-9">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent-solid)]"
                  checked={allShownPicked}
                  onChange={() =>
                    setPicked((cur) => {
                      const next = new Set(cur);
                      for (const p of shown) {
                        if (allShownPicked) next.delete(p.id);
                        else next.add(p.id);
                      }
                      return next;
                    })
                  }
                />
                Select all{deferred.trim() ? " shown" : ""}
              </label>
            )}
            {canManage && (
              <Button
                type="button"
                className="h-11 md:h-9"
                disabled={pickedShown.length === 0}
                onClick={() => setRestoring(pickedShown)}
                data-inv-restore-selected
              >
                <ArchiveRestore size={15} /> Restore{pickedShown.length ? ` ${pickedShown.length}` : ""}
              </Button>
            )}
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong px-6 py-14 text-center">
          {pool.length === 0 ? <Archive size={28} className="mb-3 text-text-tertiary" /> : <PackageSearch size={28} className="mb-3 text-text-tertiary" />}
          <p className="text-sm font-medium">{pool.length === 0 ? "Nothing is archived" : `Nothing matches “${deferred.trim()}”`}</p>
          <p className="mt-1 max-w-sm text-[13px] text-text-secondary">
            {pool.length === 0 ? (
              <>
                A product archived from its panel in <Link href="/dashboard/inventory" className="text-accent underline-offset-2 hover:underline">Inventory</Link> shows up here.
              </>
            ) : (
              "Try part of a serial number or fewer words."
            )}
          </p>
        </div>
      ) : (
        <>
        {/* 1280 px and up: the column headings of the table */}
        <div aria-hidden style={{ gridTemplateColumns: cols }} className="mt-4 hidden gap-x-3 rounded-t-xl border border-b-0 border-border bg-bg-subtle px-4 py-2 text-[11px] font-medium uppercase tracking-[0.05em] text-text-tertiary xl:grid">
          <span className="w-4" />
          <span>Serial No</span>
          <span>Material Description</span>
          <span>Archived</span>
          <span className="text-right">Last balance</span>
          <span />
        </div>
        <ul role="list" aria-label="Archived products" className="mt-4 xl:mt-0 xl:rounded-t-none space-y-2.5 xl:space-y-0 xl:divide-y xl:divide-border xl:rounded-xl xl:border xl:border-border" data-inv-archive-list>
          {shown.map((p) => {
            const bal = parseQty(p.balance) ?? BigInt(0);
            return (
              <li
                key={p.id}
                style={{ ["--inv-archive-cols" as string]: cols }}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-xl border border-border bg-panel/60 p-3.5 xl:[grid-template-columns:var(--inv-archive-cols)] xl:items-center xl:rounded-none xl:border-0 xl:bg-transparent xl:px-4 xl:py-2.5"
                data-inv-archive-row={p.serial_no}
              >
                {canManage ? (
                  <input
                    type="checkbox"
                    aria-label={`Select ${p.serial_no}`}
                    checked={picked.has(p.id)}
                    onChange={() => toggle(p.id)}
                    className="mt-0.5 size-5 accent-[var(--accent-solid)] xl:mt-0 xl:size-4"
                  />
                ) : (
                  <Archive size={15} className="mt-0.5 text-text-tertiary xl:mt-0" aria-hidden />
                )}
                <span className="min-w-0 xl:contents">
                  <span className="tnum block truncate text-[12.5px] font-semibold text-accent xl:text-[13px] xl:text-text">
                    <Highlight text={p.serial_no} query={deferred} />
                  </span>
                  <span className="block min-w-0 text-[14px] font-medium xl:truncate xl:text-[13px]">
                    <Highlight text={p.description} query={deferred} />
                    {p.specification && (
                      <span className="font-normal text-text-secondary">
                        {" · "}
                        <Highlight text={p.specification} query={deferred} />
                      </span>
                    )}
                  </span>
                </span>
                <span className="col-start-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-text-secondary xl:contents">
                  <span className="tnum xl:text-[12.5px]">
                    <span className="text-text-tertiary xl:hidden">Archived </span>
                    {p.archived_at ? formatDateTime(p.archived_at) : "—"}
                  </span>
                  <span className="tnum xl:text-right">
                    <span className="text-text-tertiary xl:hidden">Last balance </span>
                    <span className="font-medium text-text">{formatQty(bal)}</span>
                  </span>
                </span>
                <span className="col-start-2 flex flex-wrap items-center gap-2 xl:col-auto xl:justify-end">
                  {canManage ? (
                    <>
                      <Button type="button" variant="secondary" className="h-11 xl:h-9" onClick={() => setRestoring([p])}>
                        <ArchiveRestore size={14} /> Restore
                      </Button>
                      {p.has_history ? (
                        <span className="inline-flex items-center gap-1 text-[12px] text-text-tertiary" data-inv-has-history>
                          <History size={13} /> Has history, can only be restored
                        </span>
                      ) : (
                        <Button type="button" variant="danger" className="h-11 xl:h-9" onClick={() => setDeleting(p)} data-inv-delete>
                          <Trash2 size={14} /> Delete
                        </Button>
                      )}
                    </>
                  ) : (
                    <span className="text-[12px] text-text-tertiary">
                      {p.entries > 0 ? `${p.entries} entr${p.entries === 1 ? "y" : "ies"}` : p.has_history ? "History: closed months" : "No history"}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        </>
      )}

      {deleted > 0 && (
        <p className="mt-4 text-[12px] text-text-tertiary">
          {deleted} product{deleted === 1 ? " was" : "s were"} deleted from the archive (a full copy of each is kept in the database).
        </p>
      )}

      {restoring && (
        <RestoreSheet
          items={restoring}
          onClose={() => setRestoring(null)}
          onDone={(n) => {
            toast("success", n === 1 ? `${restoring[0].serial_no} restored.` : `${n} products restored.`);
            setGone((g) => new Set([...g, ...restoring.map((p) => p.id)]));
            setPicked((cur) => new Set([...cur].filter((id) => !restoring.some((p) => p.id === id))));
            setRestoring(null);
            router.refresh();
          }}
        />
      )}
      {deleting && (
        <DeleteSheet
          item={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => {
            toast("success", `${deleting.serial_no} deleted.`);
            setGone((g) => new Set([...g, deleting.id]));
            setDeleting(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function RestoreSheet({ items, onClose, onDone }: { items: InvArchivedProduct[]; onClose: () => void; onDone: (n: number) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  async function go() {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await restoreProducts(items.map((p) => p.id));
      if (res.ok) onDone(res.changed ?? items.length);
      else setError(res.error);
    } catch {
      setError("No answer from the server. Please try again: nothing is restored twice.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  const one = items.length === 1;
  return (
    <Sheet
      open
      onClose={onClose}
      busy={saving}
      title={one ? `Restore ${items[0].serial_no}?` : `Restore ${items.length} products?`}
      description={one ? items[0].description : undefined}
    >
      <div className="space-y-4 text-[13px] text-text-secondary">
        <p>
          {one ? "It comes" : "They come"} back to the stock list with {one ? "its" : "their"} history and take entries again.
          The ledger and the balance don&apos;t change.
        </p>
        <p className="rounded-lg border border-accent/30 bg-accent/[0.06] px-3 py-2">
          From December 2026: a product that existed before this month comes back <span className="font-medium text-text">Pending</span> until
          its balance is counted for the month (one added this month comes back confirmed).
        </p>
        {!one && (
          <ul className="tnum max-h-40 overflow-y-auto rounded-lg border border-border px-3 py-2 text-[12.5px]">
            {items.map((p) => (
              <li key={p.id} className="truncate">
                <span className="font-medium text-text">{p.serial_no}</span> · {p.description}
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-status-danger">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" size="lg" className="h-11" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" size="lg" className="h-11" onClick={go} loading={saving} data-autofocus>
            {saving ? "Restoring…" : one ? "Restore product" : `Restore ${items.length} products`}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function DeleteSheet({ item, onClose, onDone }: { item: InvArchivedProduct; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const matches = typed.trim().toUpperCase() === item.serial_no.toUpperCase();
  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (busy.current || !matches) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await deleteArchivedProduct(item.id, typed);
      if (res.ok) onDone();
      else setError(res.error);
    } catch {
      setError("No answer from the server. Please check the archive again.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return (
    <Sheet open onClose={onClose} busy={saving} title={`Delete ${item.serial_no} for good?`} description={item.description}>
      <form onSubmit={go} className="space-y-4 text-[13px] text-text-secondary" noValidate>
        <p>
          Only for a product added by mistake: it has <span className="font-medium text-text">no entries, no stock count and no closed month</span>.
          It disappears from the archive and can&apos;t be restored. A full copy is kept in the database.
        </p>
        <div>
          <FieldLabel htmlFor="inv-delete-confirm">
            Type <span className="tnum font-semibold text-text">{item.serial_no}</span> to confirm
          </FieldLabel>
          <Field id="inv-delete-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} data-autofocus />
        </div>
        {error && (
          <p role="alert" className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-status-danger">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" size="lg" className="h-11" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" size="lg" className={cn("h-11")} loading={saving} disabled={!matches}>
            {saving ? "Deleting…" : "Delete for good"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
