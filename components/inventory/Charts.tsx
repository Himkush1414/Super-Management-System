"use client";

import { formatQty, parseQty } from "@/lib/inventory/numbers";
import type { InvOverview } from "@/lib/inventory/types";
import { cn } from "@/lib/utils";
import { monthLabel, monthShort } from "./model";

/** The admin tier's trend + top 10, loaded only for them, after the list. */
export function Charts({ trend, top, month }: { trend: InvOverview["trend"]; top: InvOverview["top_issued"]; month: string }) {
  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <TrendChart trend={trend} />
      <TopIssued top={top} month={month} />
    </div>
  );
}

/** Received vs issued per month, 6 months — inline SVG, no chart library. */
export function TrendChart({ trend }: { trend: InvOverview["trend"] }) {
  const data = trend.map((t) => ({ m: t.month, r: parseQty(t.received) ?? BigInt(0), i: parseQty(t.issued) ?? BigInt(0) }));
  const max = data.reduce((a, d) => (d.r > a ? d.r : d.i > a ? d.i : a), BigInt(1));
  const pct = (v: bigint) => Number((v * BigInt(1000)) / max) / 10; // 0–100, one decimal
  const empty = data.every((d) => d.r === BigInt(0) && d.i === BigInt(0));
  return (
    <figure className="flex flex-col rounded-xl border border-border bg-panel/60 p-4">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold">Received vs issued · 6 months</span>
        <span className="flex items-center gap-3 text-[11.5px] text-text-tertiary">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-status-success" /> Received</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-status-info" /> Issued</span>
        </span>
      </figcaption>
      {empty ? (
        <p className="mt-6 pb-4 text-center text-[13px] text-text-tertiary">No movement in these months yet.</p>
      ) : (
        <div className="mt-4 grid min-h-40 flex-1 grid-cols-6 items-end gap-2 sm:gap-4" role="list">
          {data.map((d) => (
            <div key={d.m} role="listitem" className="flex h-full flex-col items-center justify-end gap-1.5" aria-label={`${monthLabel(d.m)}: received ${formatQty(d.r)}, issued ${formatQty(d.i)}`}>
              <div className="flex h-full w-full items-end justify-center gap-1">
                <Bar pct={pct(d.r)} className="bg-status-success/80" title={`Received ${formatQty(d.r)}`} />
                <Bar pct={pct(d.i)} className="bg-status-info/80" title={`Issued ${formatQty(d.i)}`} />
              </div>
              <span className="text-[11px] text-text-tertiary">{monthShort(d.m)}</span>
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}

function Bar({ pct, className, title }: { pct: number; className: string; title: string }) {
  return (
    <div className="flex h-full w-full max-w-5 items-end" title={title}>
      <div
        className={cn("w-full rounded-t-[4px] transition-[height] duration-500 ease-out motion-reduce:transition-none", className)}
        style={{ height: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
      />
    </div>
  );
}

/** The month's 10 most issued products. */
export function TopIssued({ top, month }: { top: InvOverview["top_issued"]; month: string }) {
  const max = top.reduce((a, t) => {
    const v = parseQty(t.issued) ?? BigInt(0);
    return v > a ? v : a;
  }, BigInt(1));
  return (
    <section className="rounded-xl border border-border bg-panel/60 p-4" aria-labelledby="inv-top">
      <h2 id="inv-top" className="text-[13px] font-semibold">
        Most issued · {monthLabel(month)}
      </h2>
      {top.length === 0 ? (
        <p className="mt-6 pb-4 text-center text-[13px] text-text-tertiary">Nothing issued this month yet.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {top.map((t, i) => {
            const v = parseQty(t.issued) ?? BigInt(0);
            return (
              <li key={t.id} className="text-[12.5px]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className="tnum mr-1.5 text-text-tertiary">{i + 1}.</span>
                    <span className="font-medium">{t.serial_no}</span>
                    <span className="text-text-secondary"> · {t.description}{t.specification ? ` ${t.specification}` : ""}</span>
                  </span>
                  <span className="tnum shrink-0 font-semibold">{formatQty(v)}</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-overlay/[0.06]">
                  <div className="h-full rounded-full bg-status-info/70" style={{ width: `${Number((v * BigInt(100)) / max)}%` }} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
