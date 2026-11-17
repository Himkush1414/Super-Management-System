"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A confirmation / form surface: a bottom sheet on phones (thumb reach, safe
 * area aware), a centred dialog from 768px. Focus moves in on open, Tab
 * stays inside, Escape and the backdrop close it (unless `busy`), and focus
 * returns to whatever opened it. CSS transitions only; reduced motion = none.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  busy,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** while saving: can't be dismissed */
  busy?: boolean;
  wide?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  const descId = useId();
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useLayoutEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  });

  // open -> mount, next frame "shown" (enter transition); close -> transition out -> unmount
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(raf);
    }
    const raf = requestAnimationFrame(() => setShown(false));
    const t = setTimeout(() => setMounted(false), 220);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !mounted) return;
    opener.current = document.activeElement;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFirst = setTimeout(() => {
      const el = panel.current?.querySelector<HTMLElement>("[data-autofocus]") ??
        panel.current?.querySelector<HTMLElement>("input,select,textarea,button:not([data-close])");
      el?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) {
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key === "Tab" && panel.current) {
        const f = [...panel.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        )];
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(focusFirst);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
      (opener.current as HTMLElement | null)?.focus?.({ preventScroll: true });
    };
  }, [open, mounted]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end justify-center md:items-center md:p-6">
      <div
        aria-hidden
        onClick={() => !busy && onClose()}
        className={cn(
          "absolute inset-0 bg-black/60 backdrop-blur-[2px] transition-opacity duration-200 motion-reduce:transition-none",
          shown ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          "relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden border border-border-strong bg-panel shadow-[0_-12px_48px_-12px_rgba(0,0,0,0.6)]",
          "rounded-t-2xl md:rounded-2xl md:shadow-2xl",
          wide ? "md:max-w-2xl" : "md:max-w-md",
          "transition-[transform,opacity] duration-[220ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
          shown ? "translate-y-0 opacity-100 md:scale-100" : "translate-y-8 opacity-0 md:translate-y-2 md:scale-[0.98]",
        )}
      >
        {/* grab handle (phones) */}
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-overlay/20 md:hidden" />
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 pb-3.5 pt-3 md:pt-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[15px] font-semibold tracking-[-0.01em]">
              {title}
            </h2>
            {description && (
              <div id={descId} className="mt-0.5 text-[13px] text-text-secondary">
                {description}
              </div>
            )}
          </div>
          <button
            type="button"
            data-close
            onClick={onClose}
            disabled={busy}
            className="nr-interactive -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-overlay/[0.06] hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40 md:size-9"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
