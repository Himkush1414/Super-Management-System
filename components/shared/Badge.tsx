import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/types/database.types";
import { stageName } from "@/lib/orders";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const tones: Record<Tone, string> = {
  neutral: "bg-white/[0.09] text-text ring-white/15",
  success: "bg-status-success/15 text-status-success ring-status-success/30",
  warning: "bg-status-warning/15 text-status-warning ring-status-warning/30",
  danger: "bg-status-danger/15 text-status-danger ring-status-danger/30",
  info: "bg-status-info/15 text-status-info ring-status-info/30",
  accent: "bg-accent/15 text-accent ring-accent/35",
};

export function Badge({
  children,
  tone = "neutral",
  className,
  dot,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium leading-none tracking-[0.01em] ring-1 ring-inset whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {dot && <span className="-ml-0.5 size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const stageTone = (n: number): Tone =>
  n >= 5 ? "success" : n === 4 ? "info" : n >= 2 ? "accent" : "neutral";

export function StageBadge({ stage }: { stage: number }) {
  return (
    <Badge tone={stageTone(stage)} dot>
      {stage} · {stageName(stage)}
    </Badge>
  );
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  if (status === "waiting_on_production_phone") {
    return <Badge tone="warning">Waiting on production phone</Badge>;
  }
  return <Badge tone="success" dot>Active</Badge>;
}

export function WhatsAppBadge({ created }: { created: boolean }) {
  return created ? (
    <Badge tone="success">WhatsApp group ready</Badge>
  ) : (
    <Badge tone="neutral">WhatsApp: not configured</Badge>
  );
}
