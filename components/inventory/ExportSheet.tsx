"use client";

import { useId, useState } from "react";
import { FileText, FileType2, Download } from "lucide-react";
import { RANGE_LABELS, dmySlash, resolveRange, exportFileName, type RangeKind } from "@/lib/inventory/ranges";
import { cn } from "@/lib/utils";
import { DayField, FieldLabel } from "./bits";
import { Sheet } from "./Sheet";

const KINDS: RangeKind[] = ["week", "month", "prev_month", "all", "custom"];

/**
 * Pick a range and a format; the file is made on the server
 * (/dashboard/inventory/export). A plain link with `download`, so the
 * Android app's existing download bridge saves and opens it like every
 * other export.
 */
export function ExportSheet({ open, onClose, today, earliest }: { open: boolean; onClose: () => void; today: string; earliest: string }) {
  const uid = useId();
  const [kind, setKind] = useState<RangeKind>("month");
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const range = resolveRange(kind, today, { from, to, earliest });

  const href = (format: "pdf" | "docx") => {
    const p = new URLSearchParams({ format, range: kind });
    if (kind === "custom" && range) {
      p.set("from", range.from);
      p.set("to", range.to);
    }
    return `/dashboard/inventory/export?${p.toString()}`;
  };

  return (
    <Sheet open={open} onClose={onClose} title="Export product specification" description="Opening = balance before the first day · Received and Issued inside the range · Closing = balance on the last day. Dates in IST.">
      <div className="space-y-4">
        <fieldset>
          <legend className="nr-section-label">Range</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {KINDS.map((k) => (
              <label
                key={k}
                className={cn(
                  "nr-interactive flex h-11 cursor-pointer items-center justify-center rounded-lg border px-2 text-[13px] font-medium md:h-10",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/60",
                  kind === k ? "border-accent/50 bg-accent/10 text-text" : "border-border text-text-secondary hover:border-border-strong hover:text-text",
                )}
              >
                <input type="radio" name={`${uid}-k`} value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
                {RANGE_LABELS[k]}
              </label>
            ))}
          </div>
        </fieldset>

        {kind === "custom" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor={`${uid}-f`}>From</FieldLabel>
              <DayField id={`${uid}-f`} value={from} onChange={setFrom} max={today} />
            </div>
            <div>
              <FieldLabel htmlFor={`${uid}-t`}>To</FieldLabel>
              <DayField id={`${uid}-t`} value={to} onChange={setTo} max={today} />
            </div>
          </div>
        )}

        <p className="tnum rounded-lg bg-bg-subtle px-3 py-2.5 text-[13px] text-text-secondary">
          {range ? (
            <>
              <span className="font-medium text-text">
                {dmySlash(range.from)} – {dmySlash(range.to)}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-text-tertiary">{exportFileName(range.from, range.to, "pdf").replace(/\.pdf$/, "")}</span>
            </>
          ) : (
            <span className="text-status-danger">Choose a start date on or before the end date.</span>
          )}
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          {(["pdf", "docx"] as const).map((f) =>
            range ? (
              <a
                key={f}
                href={href(f)}
                download={exportFileName(range.from, range.to, f)}
                className="nr-interactive nr-press group flex h-14 items-center gap-3 rounded-xl border border-border-strong bg-elevated px-4 text-[14px] font-medium hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                {f === "pdf" ? <FileText size={18} className="text-status-danger" /> : <FileType2 size={18} className="text-status-info" />}
                <span className="flex-1">
                  {f === "pdf" ? "PDF" : "Word"}
                  <span className="block text-[11.5px] font-normal text-text-tertiary">{f === "pdf" ? "A4 landscape" : ".docx, editable table"}</span>
                </span>
                <Download size={16} className="text-text-tertiary group-hover:text-text" />
              </a>
            ) : (
              <span key={f} aria-disabled className="flex h-14 items-center rounded-xl border border-border px-4 text-[14px] text-text-tertiary">
                {f === "pdf" ? "PDF" : "Word"}
              </span>
            ),
          )}
        </div>
      </div>
    </Sheet>
  );
}
