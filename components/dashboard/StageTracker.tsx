import { Check } from "lucide-react";
import { STAGES } from "@/lib/orders";
import { cn } from "@/lib/utils";

/** Read-only 5-stage progress rail (spec §6). */
export function StageTracker({
  stage,
  compact = false,
}: {
  stage: number;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        {STAGES.map((s) => (
          <span
            key={s.n}
            title={`Stage ${s.n} — ${s.name}`}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              s.n < stage && "bg-status-success",
              s.n === stage && "bg-accent",
              s.n > stage && "bg-white/10",
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <ol className="space-y-0">
      {STAGES.map((s, i) => {
        const done = s.n < stage;
        const current = s.n === stage;
        return (
          <li key={s.n} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold tnum",
                  done && "border-status-success/40 bg-status-success/15 text-status-success",
                  current && "border-accent bg-accent text-accent-fg",
                  !done && !current && "border-border-strong text-text-tertiary",
                )}
              >
                {done ? <Check size={13} /> : s.n}
              </span>
              {i < STAGES.length - 1 && (
                <span
                  className={cn(
                    "my-1 w-px flex-1",
                    s.n < stage ? "bg-status-success/40" : "bg-border-strong",
                  )}
                />
              )}
            </div>
            <div className={cn("pb-4 pt-1", i === STAGES.length - 1 && "pb-0")}>
              <p
                className={cn(
                  "text-[13px] font-medium",
                  current ? "text-text" : done ? "text-text-secondary" : "text-text-tertiary",
                )}
              >
                Stage {s.n}
              </p>
              <p
                className={cn(
                  "text-[13px]",
                  current ? "text-text" : "text-text-tertiary",
                )}
              >
                {s.name}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
