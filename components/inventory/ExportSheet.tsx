"use client";

import { useId, useRef, useState } from "react";
import { FileText, FileType2, FileSpreadsheet, Download } from "lucide-react";
import { RANGE_LABELS, dmySlash, resolveRange, exportFileName, type RangeKind } from "@/lib/inventory/ranges";
import { cn } from "@/lib/utils";
import { DayField, FieldLabel } from "./bits";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { downloadFile } from "./download";

type Format = "pdf" | "docx" | "xlsx";
const FORMATS: { f: Format; name: string; sub: string; icon: typeof FileText; tone: string }[] = [
  { f: "pdf", name: "PDF", sub: "A4 landscape", icon: FileText, tone: "text-status-danger" },
  { f: "docx", name: "Word", sub: ".docx, editable table", icon: FileType2, tone: "text-status-info" },
  { f: "xlsx", name: "Excel", sub: ".xlsx, numbers you can sum", icon: FileSpreadsheet, tone: "text-status-success" },
];

const KINDS: RangeKind[] = ["week", "month", "prev_month", "all", "custom"];

/**
 * Pick a range and a format; the file is made on the server
 * (/dashboard/inventory/export). One tap: the button says "Preparing…" at
 * once and ignores further taps until the file is saved (browser) or
 * handed to the Android app (download.ts).
 */
export function ExportSheet({ open, onClose, today, earliest }: { open: boolean; onClose: () => void; today: string; earliest: string }) {
  const uid = useId();
  const [kind, setKind] = useState<RangeKind>("month");
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const range = resolveRange(kind, today, { from, to, earliest });

  const toast = useToast();
  const [busy, setBusy] = useState<Format | null>(null);
  const busyRef = useRef(false);

  async function get(format: Format) {
    if (!range || busyRef.current) return; // a second tap while preparing does nothing
    busyRef.current = true;
    setBusy(format);
    try {
      await downloadFile(href(format), exportFileName(range.from, range.to, format));
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "The download failed. Please try again.");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const href = (format: Format) => {
    const p = new URLSearchParams({ format, range: kind });
    if (kind === "custom" && range) {
      p.set("from", range.from);
      p.set("to", range.to);
    }
    return `/dashboard/inventory/export?${p.toString()}`;
  };

  return (
    <Sheet open={open} onClose={onClose} wide title="Export product specification" description="Opening = balance before the first day · Received and Issued inside the range · Closing = balance on the last day. Dates in IST.">
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

        <div className="grid gap-2 sm:grid-cols-3">
          {FORMATS.map(({ f, name, sub, icon: Icon, tone }) => {
            const preparing = busy === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => get(f)}
                disabled={!range || (busy !== null && !preparing)}
                aria-busy={preparing}
                aria-disabled={preparing || undefined}
                className={cn(
                  "nr-interactive nr-press group flex h-14 items-center gap-3 rounded-xl border px-4 text-left text-[14px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50",
                  preparing ? "cursor-progress border-accent/50 bg-accent/10" : "border-border-strong bg-elevated hover:border-accent/50",
                )}
              >
                {preparing ? (
                  <span aria-hidden className="size-[18px] shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent motion-reduce:animate-none" />
                ) : (
                  <Icon size={18} className={cn("shrink-0", tone)} />
                )}
                <span className="min-w-0 flex-1">
                  {preparing ? "Preparing…" : name}
                  <span className="block truncate text-[11.5px] font-normal text-text-tertiary">{preparing ? `${name} file` : sub}</span>
                </span>
                {!preparing && <Download size={16} className="shrink-0 text-text-tertiary group-hover:text-text" />}
              </button>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}
