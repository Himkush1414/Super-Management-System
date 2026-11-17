"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { highlight } from "@/lib/inventory/search";
import { formatQty, parseQty } from "@/lib/inventory/numbers";
import { parseDmy, cn } from "@/lib/utils";

/** Search hits, highlighted. */
export function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim() || !text) return <>{text}</>;
  return (
    <>
      {highlight(text, query).map((s, i) =>
        s.hit ? (
          <mark key={i} className="rounded-[3px] bg-accent/25 px-px text-text ring-1 ring-accent/30">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/** Decimal text from the database -> "1,23,456.5". */
export const qty = (text: string | null | undefined) => formatQty(text == null ? null : parseQty(text));

/**
 * Smooth height reveal (~280 ms, eased) for an expanded row. The content
 * mounts on open and unmounts after closing, so 350 collapsed rows cost
 * nothing. `prefers-reduced-motion`: instant.
 */
export function Expand({ open, children, id }: { open: boolean; children: React.ReactNode; id?: string }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(raf);
    }
    const raf = requestAnimationFrame(() => setShown(false));
    const t = setTimeout(() => setMounted(false), 300);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [open]);
  return (
    <div
      id={id}
      className={cn(
        "grid transition-[grid-template-rows] duration-[280ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
        shown ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
    >
      <div className="min-h-0 overflow-hidden">{mounted ? children : null}</div>
    </div>
  );
}

/**
 * Date field that always shows DD/MM/YYYY (like components/ui/DateField),
 * controlled, 44 px tall for touch, limited to [min, max]. `onChange` gets
 * the ISO date, or "" while the text isn't a real date yet.
 */
export function DayField({
  id,
  value,
  onChange,
  min,
  max,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  describedBy?: string;
}) {
  const toDmy = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
  const [text, setText] = useState(toDmy(value));
  const picker = useRef<HTMLInputElement>(null);
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(toDmy(value));
    }
  }, [value]);
  function set(next: string) {
    setText(next);
    const iso = parseDmy(next) ?? "";
    last.current = iso;
    onChange(iso);
  }
  return (
    <div className="relative">
      <input
        id={id}
        value={text}
        onChange={(e) => {
          const d = e.target.value.replace(/\D/g, "").slice(0, 8);
          set([d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter(Boolean).join("/"));
        }}
        placeholder="DD/MM/YYYY"
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        aria-describedby={describedBy}
        className="tnum h-11 w-full rounded-lg border border-border-strong bg-bg-subtle px-3 pr-11 text-[16px] text-text placeholder:text-text-tertiary focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 md:text-sm"
      />
      <button
        type="button"
        aria-label="Open calendar"
        onClick={() => picker.current?.showPicker?.()}
        className="nr-interactive absolute inset-y-0 right-0 flex w-11 items-center justify-center text-text-tertiary hover:text-text-secondary"
      >
        <CalendarDays size={16} />
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        min={min}
        max={max}
        value={parseDmy(text) ?? ""}
        onChange={(e) => set(toDmy(e.target.value))}
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
      />
    </div>
  );
}

/** Text input, 44 px tall on phones. */
export function Field({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-11 w-full rounded-lg border border-border-strong bg-bg-subtle px-3 text-[16px] text-text placeholder:text-text-tertiary md:h-10 md:text-sm",
        "focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50",
        className,
      )}
    />
  );
}

export function FieldLabel({ htmlFor, children, hint }: { htmlFor: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px] font-medium text-text-secondary">
      <span>{children}</span>
      {hint && <span className="text-[12px] font-normal text-text-tertiary">{hint}</span>}
    </label>
  );
}

/** A random idempotency key for one form submission. */
export function newKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
