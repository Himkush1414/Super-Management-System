import { cn } from "@/lib/utils";
import { ROLE_LABEL, type Role } from "@/lib/permissions";
import type { ProjectStatus, TaskStatus, UserStatus } from "@/types/database.types";

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

const roleTone: Record<Role, Tone> = {
  head_admin: "accent",
  admin: "info",
  manager: "success",
  product_supervisor: "warning",
  maker: "neutral",
};

export function RoleBadge({ role }: { role: Role }) {
  return <Badge tone={roleTone[role]}>{ROLE_LABEL[role]}</Badge>;
}

const projectStatusTone: Record<ProjectStatus, Tone> = {
  draft: "neutral",
  quoted: "info",
  approved: "info",
  in_production: "accent",
  quality_check: "warning",
  completed: "success",
  on_hold: "warning",
  cancelled: "danger",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge tone={projectStatusTone[status]} dot>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

const taskStatusTone: Record<TaskStatus, Tone> = {
  assigned: "neutral",
  in_progress: "info",
  completed: "success",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge tone={taskStatusTone[status]} dot>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

const userStatusTone: Record<UserStatus, Tone> = {
  pending: "warning",
  active: "success",
  rejected: "danger",
  suspended: "neutral",
};

export function UserStatusBadge({ status }: { status: UserStatus }) {
  return <Badge tone={userStatusTone[status]}>{status}</Badge>;
}
