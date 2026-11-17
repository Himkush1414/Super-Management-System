"use client";

import { useMemo } from "react";
import { ListFilter } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatQty, shortfall } from "@/lib/inventory/numbers";
import { formatDay } from "@/lib/utils";
import { Sheet } from "./Sheet";
import type { Row } from "./model";

/** The Low Stock list: every product below its minimum, most urgent first. */
export function LowStockSheet({
  open,
  rows,
  onClose,
  onShowInList,
}: {
  open: boolean;
  rows: Row[];
  onClose: () => void;
  onShowInList: () => void;
}) {
  // out of stock first, then the largest shortfall
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const za = a.b === BigInt(0) ? 0 : 1;
        const zb = b.b === BigInt(0) ? 0 : 1;
        if (za !== zb) return za - zb;
        const sa = shortfall(a.b, a.min);
        const sb = shortfall(b.b, b.min);
        return sa === sb ? a.serial_no.localeCompare(b.serial_no) : sa > sb ? -1 : 1;
      }),
    [rows],
  );
  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title="Low stock"
      description={`${rows.length} ${rows.length === 1 ? "item is" : "items are"} below the minimum. Order advised.`}
    >
      <div className="space-y-3">
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {sorted.map((r) => {
            const out = r.b === BigInt(0);
            return (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="tnum text-[12px] font-semibold text-accent">{r.serial_no}</p>
                    <p className="text-[14px] font-medium leading-snug">{r.description}</p>
                    {r.specification && <p className="text-[12.5px] text-text-secondary">{r.specification}</p>}
                  </div>
                  <span
                    className={
                      out
                        ? "shrink-0 rounded-full bg-status-danger/12 px-2 py-0.5 text-[11px] font-semibold text-status-danger ring-1 ring-inset ring-status-danger/30"
                        : "shrink-0 rounded-full bg-status-warning/12 px-2 py-0.5 text-[11px] font-semibold text-status-warning ring-1 ring-inset ring-status-warning/30"
                    }
                  >
                    {out ? "Out of stock" : "Low"}
                  </span>
                </div>
                <dl className="tnum mt-2 grid grid-cols-3 gap-2 rounded-lg bg-bg-subtle/80 px-3 py-2 text-[12.5px]">
                  <div>
                    <dt className="text-[10.5px] uppercase tracking-[0.05em] text-text-tertiary">Balance</dt>
                    <dd className="font-semibold">{formatQty(r.b)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10.5px] uppercase tracking-[0.05em] text-text-tertiary">Minimum</dt>
                    <dd>{formatQty(r.min)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10.5px] uppercase tracking-[0.05em] text-text-tertiary">Shortfall</dt>
                    <dd className="font-semibold text-status-warning">{formatQty(shortfall(r.b, r.min))}</dd>
                  </div>
                </dl>
                <p className="mt-1.5 text-[12px] text-text-tertiary">
                  {r.lastParty ? (
                    <>
                      Last from <span className="text-text-secondary">{r.lastParty}</span>
                    </>
                  ) : (
                    "No party recorded yet"
                  )}
                  {r.lastReceived ? ` · last received ${formatDay(r.lastReceived)}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" size="lg" className="h-11" onClick={onClose}>
            Close
          </Button>
          <Button type="button" size="lg" className="h-11" onClick={onShowInList}>
            <ListFilter size={15} /> Show only these in the list
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
