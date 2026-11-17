"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Toast = { id: number; tone: "success" | "error"; text: string };

const Ctx = createContext<(tone: Toast["tone"], text: string) => void>(() => {});

/** Short confirmations ("Receipt saved") above the content, clear of the phone's safe area. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, tone, text }]);
    timers.current.set(
      id,
      setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
        timers.current.delete(id);
      }, tone === "error" ? 6000 : 3200),
    );
  }, []);

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => clearTimeout(t));
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[120] flex flex-col items-center gap-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={cn(
              "nr-fade-in pointer-events-auto flex max-w-md items-center gap-2.5 rounded-xl border bg-elevated px-4 py-3 text-[13px] font-medium shadow-[0_12px_40px_-8px_rgba(0,0,0,0.55)]",
              t.tone === "success" ? "border-status-success/35" : "border-status-danger/40",
            )}
          >
            {t.tone === "success" ? (
              <CheckCircle2 size={16} className="shrink-0 text-status-success" />
            ) : (
              <AlertCircle size={16} className="shrink-0 text-status-danger" />
            )}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
