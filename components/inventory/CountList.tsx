"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, CornerDownLeft, Equal, Loader2 } from "lucide-react";
import { formatQty, parseQty, qtyToText } from "@/lib/inventory/numbers";
import { nextKey } from "@/lib/inventory/ledger";
import { recordStockCount } from "@/lib/inventory/actions";
import { cn } from "@/lib/utils";
import { Highlight, newKey } from "./bits";
import type { Row } from "./model";

export type CountedEvent = { productId: string; countId: number; balanceAfter: string; adjustment: string; belowMin?: boolean };

/**
 * The fast month-start balance screen: one numeric input per product,
 * Enter saves the row and moves to the next one, "Same as opening" saves
 * the opening as the counted balance. Each save is its own small request
 * (a stock count with adjustment = counted − opening). Rows stay in place
 * after saving (marked confirmed), so focus never jumps.
 */
export function CountList({
  rows,
  query,
  onCounted,
  onNeedMore,
}: {
  rows: Row[];
  query: string;
  onCounted: (e: CountedEvent) => void;
  /** Enter on the last row shown: show more rows (then focus moves on) */
  onNeedMore: () => void;
}) {
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const order = useRef<string[]>([]);
  useLayoutEffect(() => {
    order.current = rows.map((r) => r.id);
  }, [rows]);
  const pendingFocus = useRef<number | null>(null);

  const focusAt = useCallback((i: number) => {
    const id = order.current[i];
    const el = id ? inputs.current.get(id) : undefined;
    if (el) {
      el.focus({ preventScroll: true });
      el.select();
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      return true;
    }
    return false;
  }, []);

  // more rows arrived after "Enter" on the last one: continue there
  useEffect(() => {
    if (pendingFocus.current !== null && focusAt(pendingFocus.current)) pendingFocus.current = null;
  });

  const next = useCallback(
    (id: string) => {
      const i = order.current.indexOf(id) + 1;
      if (!focusAt(i)) {
        pendingFocus.current = i;
        onNeedMore();
      }
    },
    [focusAt, onNeedMore],
  );
  const register = useCallback((id: string, el: HTMLInputElement | null) => {
    if (el) inputs.current.set(id, el);
    else inputs.current.delete(id);
  }, []);

  return (
    <ul id="inv-results" role="list" aria-label="Products to count" className="space-y-2 md:space-y-0 md:divide-y md:divide-border" data-inv-count-list>
      {rows.map((r) => (
        <CountRow key={r.id} row={r} query={query} onCounted={onCounted} onNext={next} register={register} />
      ))}
    </ul>
  );
}

const CountRow = memo(function CountRow({
  row,
  query,
  onCounted,
  onNext,
  register,
}: {
  row: Row;
  query: string;
  onCounted: (e: CountedEvent) => void;
  onNext: (id: string) => void;
  register: (id: string, el: HTMLInputElement | null) => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ counted: bigint; adjustment: bigint } | null>(null);
  const attempt = useRef<{ key: string; fp: string } | null>(null);
  const busy = useRef(false);
  const inputId = `inv-count-${row.id}`;
  const confirmed = !row.pending || done !== null;

  async function save(value: string) {
    if (busy.current) return; // a second Enter in the same frame never sends twice
    const v = parseQty(value.trim());
    if (value.trim() === "" || v === null || v < BigInt(0)) {
      setError("0 or more, at most 3 decimals.");
      return;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    const norm = qtyToText(v);
    attempt.current = nextKey(attempt.current, `${row.id}\u0001${norm}`, newKey);
    try {
      const res = await recordStockCount({ productId: row.id, counted: norm, key: attempt.current.key });
      if (res.ok) {
        const adj = parseQty(res.adjustment ?? "") ?? v - row.b;
        setDone({ counted: v, adjustment: adj });
        setText("");
        attempt.current = null;
        if (res.countId) onCounted({ productId: row.id, countId: res.countId, balanceAfter: res.balanceAfter ?? norm, adjustment: qtyToText(adj), belowMin: res.belowMin });
        onNext(row.id);
      } else setError(res.error);
    } catch {
      setError("No answer. Check the connection and press Enter again: it won't be saved twice.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const opening = row.o;
  return (
    <li
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-panel/60 p-3",
        // text columns may shrink (truncate): the row never scrolls sideways next to the sidebar
        "md:grid-cols-[minmax(5rem,0.7fr)_minmax(0,2fr)_4.5rem_minmax(5.5rem,8rem)_auto_5.25rem] md:rounded-none md:border-0 md:bg-transparent md:px-3 md:py-2",
        confirmed && "bg-status-success/[0.04]",
      )}
      data-inv-count-row={row.serial_no}
      data-confirmed={confirmed || undefined}
    >
      <label htmlFor={inputId} className="col-span-2 min-w-0 md:contents">
        <span className="tnum block truncate text-[12px] font-semibold text-accent md:text-[13px] md:text-text">
          <Highlight text={row.serial_no} query={query} />
        </span>
        <span className="block min-w-0 truncate text-[14px] font-medium md:text-[13px]">
          <Highlight text={row.description} query={query} />
          {row.specification && <span className="font-normal text-text-secondary"> · {row.specification}</span>}
        </span>
      </label>
      <span className="tnum text-[13px] text-text-secondary md:text-right">
        <span className="text-[11px] uppercase tracking-[0.05em] text-text-tertiary md:hidden">Opening </span>
        {formatQty(opening)}
      </span>
      {/* phone: beside the opening; from 768 px: the last column */}
      <span className="justify-self-end text-[12px] md:order-last md:justify-self-start" aria-live="polite">
        {done ? (
          <span className="inline-flex items-center gap-1 font-medium text-status-success">
            <Check size={14} />
            <span className="tnum">{done.adjustment === BigInt(0) ? "Saved" : `${done.adjustment > BigInt(0) ? "+" : ""}${formatQty(done.adjustment)}`}</span>
          </span>
        ) : !row.pending ? (
          <span className="inline-flex items-center gap-1 text-status-success">
            <Check size={14} /> Confirmed
          </span>
        ) : (
          <span className="text-text-tertiary">Pending</span>
        )}
      </span>
      <span className="col-span-2 flex items-center gap-2 md:contents">
        <span className="relative min-w-0 flex-1">
          <input
            ref={(el) => register(row.id, el)}
            id={inputId}
            inputMode="decimal"
            enterKeyHint="next"
            autoComplete="off"
            placeholder={done ? formatQty(done.counted) : "Counted"}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (text.trim()) void save(text);
                else if (confirmed) onNext(row.id);
                else setError("Enter the balance, or use Same as opening.");
              }
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${inputId}-e` : undefined}
            aria-label={`Counted balance for ${row.serial_no}`}
            disabled={saving}
            className="tnum h-11 w-full rounded-lg border border-border-strong bg-bg-subtle px-3 pr-9 text-[16px] font-semibold text-text placeholder:font-normal placeholder:text-text-tertiary focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 md:h-9 md:text-[14px]"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" aria-hidden>
            {saving ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" /> : <CornerDownLeft size={14} />}
          </span>
        </span>
        <button
          type="button"
          onClick={() => void save(qtyToText(opening))}
          disabled={saving}
          aria-label="Same as opening"
          className="nr-interactive inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border-strong px-3 text-[13px] font-medium text-text-secondary hover:border-accent/40 hover:text-text disabled:opacity-50 md:h-9 md:px-2.5"
        >
          <Equal size={14} />
          <span className="max-lg:md:hidden">Same as opening</span>
          <span className="hidden max-lg:md:inline">Opening</span>
        </button>
      </span>
      {error && (
        <p id={`${inputId}-e`} role="alert" className="col-span-2 text-[12.5px] text-status-danger md:order-last md:col-span-6">
          {error}
        </p>
      )}
    </li>
  );
});
