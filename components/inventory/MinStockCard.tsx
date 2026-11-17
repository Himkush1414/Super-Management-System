"use client";

import { memo, useDeferredValue, useMemo, useRef, useState } from "react";
import { Search, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { parseQty } from "@/lib/inventory/numbers";
import { buildIndex, search } from "@/lib/inventory/search";
import { setMinStock, setMinStockBulk } from "@/lib/inventory/actions";
import { cn } from "@/lib/utils";
import { Field, FieldLabel } from "./bits";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { rememberMin } from "./stores";

export type MinRow = { id: string; serial_no: string; description: string; specification: string; min_stock: string | null };

const PAGE = 30;
const valid = (t: string) => !t.trim() || (parseQty(t) !== null && parseQty(t)! >= BigInt(0));
const norm = (t: string | null) => (t === null || t === "" ? "" : String(Number(t)) === t ? t : t.replace(/\.?0+$/, ""));

/**
 * Minimum stock, product by product: search, type a number, it saves on
 * Enter or when the field is left (one small request per row, no page
 * reload). "Set for all filtered" puts one minimum on every product in the
 * current search, after a confirmation.
 */
export function MinStockCard({ products }: { products: MinRow[] }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [limit, setLimit] = useState(PAGE);
  // the minimum each product has now (saved), by id
  const [mins, setMins] = useState(() => new Map(products.map((p) => [p.id, norm(p.min_stock)])));
  const index = useMemo(() => buildIndex(products, (p) => [p.serial_no, p.description, p.specification]), [products]);
  const shown = useMemo(() => search(index, deferred).map((i) => products[i]), [index, deferred, products]);
  const [lastQ, setLastQ] = useState(deferred);
  if (lastQ !== deferred) {
    setLastQ(deferred);
    setLimit(PAGE);
  }
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkValue, setBulkValue] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const bulkRef = useRef(false);

  async function applyBulk() {
    if (bulkRef.current || !valid(bulkValue)) return;
    bulkRef.current = true;
    setBulkSaving(true);
    try {
      const res = await setMinStockBulk(shown.map((p) => p.id), bulkValue);
      if (res.ok) {
        const v = bulkValue.trim() ? norm(String(bulkValue.trim())) : "";
        setMins((m) => {
          const n = new Map(m);
          shown.forEach((p) => n.set(p.id, v));
          return n;
        });
        shown.forEach((p) => rememberMin(p.id, v || null));
        toast("success", `Minimum ${v ? `set to ${v}` : "cleared"} for ${shown.length} product${shown.length === 1 ? "" : "s"}.`);
        setBulkOpen(false);
      } else toast("error", res.error);
    } catch {
      toast("error", "No answer from the server. Please try again.");
    } finally {
      bulkRef.current = false;
      setBulkSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-panel/60 lg:col-span-2" aria-labelledby="inv-min-h">
      <div className="flex flex-col gap-3 border-b border-border px-5 py-3.5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="inv-min-h" className="text-[15px] font-semibold tracking-[-0.014em]">
            Minimum stock
          </h2>
          <p className="mt-1 text-[13px] text-text-secondary">
            The Inventory page warns when a balance falls below its minimum. Empty = no alert. Saves as you leave each field.
          </p>
        </div>
        <Button type="button" variant="secondary" className="h-11 shrink-0 md:h-9" onClick={() => setBulkOpen(true)} disabled={!shown.length}>
          Set for all {deferred.trim() ? "filtered" : ""} ({shown.length})
        </Button>
      </div>
      <div className="p-5">
        <div className="relative mb-3 sm:max-w-md">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search serial, material, specification…"
            aria-label="Search products for minimum stock"
            className="h-11 w-full rounded-xl border border-border-strong bg-bg-subtle pl-10 pr-3 text-[16px] text-text placeholder:text-text-tertiary focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 md:text-sm"
          />
        </div>
        <p className="tnum mb-2 text-[12.5px] text-text-tertiary" aria-live="polite">
          {deferred.trim() ? `${shown.length} of ${products.length} products` : `${products.length} products`}
        </p>
        {shown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong px-4 py-6 text-center text-[13px] text-text-secondary">Nothing matches.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {shown.slice(0, limit).map((p) => (
              <MinRowItem
                key={p.id}
                p={p}
                saved={mins.get(p.id) ?? ""}
                onSaved={(v) => {
                  setMins((m) => new Map(m).set(p.id, v));
                  rememberMin(p.id, v || null);
                }}
              />
            ))}
          </ul>
        )}
        {shown.length > limit && (
          <div className="mt-3 flex justify-center">
            <Button type="button" variant="secondary" className="h-11 md:h-9" onClick={() => setLimit((l) => l + PAGE)}>
              Show more ({shown.length - limit} left)
            </Button>
          </div>
        )}
      </div>

      <Sheet
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        busy={bulkSaving}
        title={`Minimum for ${shown.length} product${shown.length === 1 ? "" : "s"}`}
        description={deferred.trim() ? `Every product matching “${deferred.trim()}”.` : "Every product in the list."}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void applyBulk();
          }}
          className="space-y-4"
        >
          <div>
            <FieldLabel htmlFor="inv-bulk-min" hint="Empty = remove the minimum">
              Minimum stock
            </FieldLabel>
            <Field id="inv-bulk-min" inputMode="decimal" className="tnum" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} data-autofocus />
            {!valid(bulkValue) && <p className="mt-1.5 text-[12.5px] text-status-danger">0 or more, with at most 3 decimals.</p>}
          </div>
          <p className="text-[13px] text-text-secondary">
            This replaces the minimum of all {shown.length} product{shown.length === 1 ? "" : "s"}. Each change is kept in the product&apos;s history.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" size="lg" className="h-11" onClick={() => setBulkOpen(false)} disabled={bulkSaving}>
              Cancel
            </Button>
            <Button type="submit" size="lg" className="h-11" loading={bulkSaving} disabled={!valid(bulkValue)}>
              {bulkValue.trim() ? `Set ${bulkValue.trim()} for ${shown.length}` : `Clear for ${shown.length}`}
            </Button>
          </div>
        </form>
      </Sheet>
    </section>
  );
}

const MinRowItem = memo(function MinRowItem({ p, saved, onSaved }: { p: MinRow; saved: string; onSaved: (v: string) => void }) {
  const [text, setText] = useState(saved);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const id = `inv-min-${p.id}`;

  async function save() {
    const v = text.trim();
    if (busy.current || v === saved) return;
    if (!valid(v)) {
      setState("error");
      setError("0 or more, at most 3 decimals");
      return;
    }
    busy.current = true;
    setState("saving");
    try {
      const res = await setMinStock(p.id, v);
      if (res.ok) {
        const n = v ? norm(v) : "";
        setText(n);
        onSaved(n);
        setState("saved");
        setError(null);
        setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1600);
      } else {
        setState("error");
        setError(res.error);
      }
    } catch {
      setState("error");
      setError("No answer. Try again.");
    } finally {
      busy.current = false;
    }
  }

  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="tnum block text-[12px] font-semibold text-accent">{p.serial_no}</span>
        <span className="block truncate text-[13.5px]">{p.description}</span>
        {p.specification && <span className="block truncate text-[12px] text-text-tertiary">{p.specification}</span>}
      </label>
      <div className="flex shrink-0 items-center gap-2">
        <span aria-live="polite" className="w-5">
          {state === "saving" && <span className="block size-4 animate-spin rounded-full border-2 border-accent border-t-transparent motion-reduce:animate-none" aria-label="Saving" />}
          {state === "saved" && <Check size={16} className="text-status-success" aria-label="Saved" />}
          {state === "error" && <AlertCircle size={16} className="text-status-danger" aria-label={error ?? "Not saved"} />}
        </span>
        <input
          id={id}
          inputMode="decimal"
          enterKeyHint="done"
          value={text}
          placeholder="—"
          onChange={(e) => {
            setText(e.target.value);
            if (state === "error") setState("idle");
          }}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
          aria-invalid={state === "error"}
          title={error ?? undefined}
          className={cn(
            "tnum h-11 w-24 rounded-lg border bg-bg-subtle px-3 text-right text-[16px] text-text placeholder:text-text-tertiary md:h-9 md:text-sm",
            "focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
            state === "error" ? "border-status-danger/60" : "border-border-strong",
          )}
        />
      </div>
    </li>
  );
});
