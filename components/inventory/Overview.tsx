"use client";

import { useMemo } from "react";
import { Boxes, IndianRupee, ArrowDownToLine, ArrowUpFromLine, CircleSlash } from "lucide-react";
import { formatINR, formatQty, summarize } from "@/lib/inventory/numbers";
import { cn } from "@/lib/utils";
import { monthLabel, monthShort, type Row } from "./model";

/** Summary cards: products, stock value, received / issued in the month, out of stock. */
export function SummaryCards({ rows, month }: { rows: Row[]; month: string }) {
  const s = useMemo(() => summarize(rows), [rows]);
  const m = monthShort(month);
  // phones: Products | Zero stock, Stock value (wide), Received | Issued.
  // 768+: Stock value (wide) | Products | Zero stock, then Received | Issued.
  // 1280+: one row, in reading order (Stock value wide enough for crores).
  const cards = [
    { label: "Products", value: s.products.toLocaleString("en-IN"), sub: "active", icon: Boxes, cls: "md:order-2 xl:order-1" },
    { label: "Zero stock", value: s.zero.toLocaleString("en-IN"), sub: s.zero === 1 ? "product" : "products", icon: CircleSlash, tone: s.zero ? ("warn" as const) : undefined, cls: "md:order-3 xl:order-5" },
    { label: "Stock value", value: formatINR(s.value), sub: "balance × rate", icon: IndianRupee, cls: "col-span-2 md:order-1 xl:order-2" },
    { label: `Received · ${m}`, value: formatQty(s.received), sub: `${formatINR(s.receivedValue)} value`, icon: ArrowDownToLine, tone: "in" as const, cls: "md:order-4 md:col-span-2 xl:order-3 xl:col-span-1" },
    { label: `Issued · ${m}`, value: formatQty(s.issued), sub: `${formatINR(s.issuedValue)} value`, icon: ArrowUpFromLine, tone: "out" as const, cls: "md:order-5 md:col-span-2 xl:order-4 xl:col-span-1" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-4 xl:grid-cols-6" aria-label={`Summary for ${monthLabel(month)}`} role="group">
      {cards.map((c) => (
        <div key={c.label} className={cn("relative overflow-hidden rounded-xl border border-border bg-panel/60 px-4 py-3.5", c.cls)}>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] font-medium uppercase tracking-[0.06em] text-text-tertiary">{c.label}</span>
            <c.icon
              size={15}
              aria-hidden
              className={cn(
                "shrink-0 md:max-xl:hidden",
                c.tone === "in" ? "text-status-success" : c.tone === "out" ? "text-status-info" : c.tone === "warn" ? "text-status-warning" : "text-text-tertiary",
              )}
            />
          </div>
          <div className="tnum mt-2 truncate text-[1.375rem] font-semibold leading-none tracking-[-0.02em] sm:text-[1.5rem]">{c.value}</div>
          <div className="tnum mt-1.5 truncate text-[11.5px] text-text-tertiary">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

