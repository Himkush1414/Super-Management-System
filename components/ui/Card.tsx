import { cn } from "@/lib/utils";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-panel/60 backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-3.5 border-b border-border">
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold leading-tight tracking-[-0.014em] text-text">
          {title}
        </h3>
        {description && (
          <p className="mt-1 text-[13px] leading-snug text-text-secondary">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function CardBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("p-5", className)}>{children}</div>;
}

export function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <Card className="p-[18px]">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium uppercase tracking-[0.04em] text-text-tertiary">
          {label}
        </span>
        {icon && <span className="text-text-tertiary">{icon}</span>}
      </div>
      <div className="mt-2.5 text-[1.7rem] font-semibold leading-none tracking-[-0.02em] tnum">
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[12px] text-text-tertiary">{sub}</div>}
    </Card>
  );
}
