"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { STAGE_TIMER_MS, stageName } from "@/lib/orders";

function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Full-width countdown shown above an order while the next stage is locked.
 * `stageReadyAt` comes straight from the row, so a refresh mid-countdown
 * recomputes the correct remaining time instead of resetting it.
 */
export function StageTimerBar({
  stageReadyAt,
  nextStage,
}: {
  stageReadyAt: string | null;
  nextStage: number;
}) {
  const target = stageReadyAt ? new Date(stageReadyAt).getTime() : null;

  // `now` starts correct via the lazy useState initializer (runs once, on
  // mount) and afterwards is only ever updated from the interval callback —
  // the render body itself never calls the impure Date.now() directly.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  const remaining = target ? Math.max(0, target - now) : 0;
  if (!target || remaining <= 0) return null;

  return (
    <div
      className="mb-5 space-y-2 rounded-xl border border-border bg-panel/60 p-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px]">
        <span className="flex items-center gap-1.5 text-text-secondary">
          <Clock size={14} />
          Stage {nextStage} — {stageName(nextStage)} opens in
        </span>
        <span className="tnum font-semibold text-text">{formatCountdown(remaining)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.min(100, (remaining / STAGE_TIMER_MS) * 100)}%` }}
        />
      </div>
    </div>
  );
}
