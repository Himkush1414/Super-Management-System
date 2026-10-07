"use client";

import { useMemo, useState } from "react";
import { FileDown } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Select, Label } from "@/components/ui/Field";
import { cn } from "@/lib/utils";
import { periodContaining, periodsWithOrders, type PeriodKind } from "@/lib/periods";

const KINDS: { kind: PeriodKind; label: string }[] = [
  { kind: "week", label: "Week" },
  { kind: "month", label: "Month" },
  { kind: "year", label: "Year" },
  { kind: "all", label: "All time" },
];

/**
 * "Download All Orders": one PDF with a table of every order the viewer can
 * see, for a chosen week / month / year (by punch date, IST) or all time.
 * The PDF route applies the price rule; this only builds the link.
 */
export function BulkExport({
  punchedAt,
  today,
  className,
}: {
  /** created_at of every order the viewer can see */
  punchedAt: string[];
  /** today in IST, YYYY-MM-DD (from the server, so it can't drift) */
  today: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PeriodKind>("month");
  const [start, setStart] = useState<string | null>(null);

  const options = useMemo(() => {
    if (kind === "all") return [];
    const current = periodContaining(kind, today);
    const withOrders = periodsWithOrders(kind, punchedAt);
    const list = withOrders.some((p) => p.period.start === current.start)
      ? withOrders
      : [{ period: current, count: 0 }, ...withOrders];
    return list.map(({ period, count }) => ({
      start: period.start!,
      label:
        (period.start === current.start ? `This ${kind} · ` : "") +
        `${period.label} (${count} order${count === 1 ? "" : "s"})`,
      count,
    }));
  }, [kind, punchedAt, today]);

  const chosen = kind === "all" ? null : (options.find((o) => o.start === start) ?? options[0]);
  const count =
    kind === "all" ? punchedAt.length : (chosen?.count ?? 0);
  const href =
    kind === "all"
      ? "/dashboard/orders/pdf?period=all"
      : `/dashboard/orders/pdf?period=${kind}&at=${chosen?.start ?? today}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "nr-interactive inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-elevated px-3 text-[13px] font-medium text-text hover:border-border-strong hover:bg-panel-2",
          className,
        )}
      >
        <FileDown size={14} />
        <span className="hidden sm:inline">Download All Orders</span>
        <span className="sm:hidden">All orders</span>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Download all orders"
        description="One PDF with a table of every order in the period you choose, grouped by date."
      >
        <div className="space-y-4">
          <div>
            <Label>Period</Label>
            <div role="radiogroup" aria-label="Period" className="grid grid-cols-4 gap-1 rounded-lg border border-border bg-bg-subtle p-1">
              {KINDS.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.kind}
                  onClick={() => {
                    setKind(k.kind);
                    setStart(null);
                  }}
                  className={cn(
                    "nr-interactive rounded-md px-2 py-1.5 text-[13px] font-medium",
                    kind === k.kind ? "bg-elevated text-text shadow-sm" : "text-text-secondary hover:text-text",
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          {kind !== "all" && (
            <div>
              <Label htmlFor="bulk-period">Which {kind}</Label>
              <Select
                id="bulk-period"
                value={chosen?.start ?? ""}
                onChange={(e) => setStart(e.target.value)}
              >
                {options.map((o) => (
                  <option key={o.start} value={o.start}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] text-text-tertiary">
              {count} order{count === 1 ? "" : "s"} · grouped by{" "}
              {kind === "week" ? "day" : kind === "month" ? "week" : "month"}
            </p>
            <a
              href={href}
              download
              onClick={() => setOpen(false)}
              className="nr-interactive nr-press inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover"
            >
              <FileDown size={15} /> Download PDF
            </a>
          </div>
        </div>
      </Modal>
    </>
  );
}

