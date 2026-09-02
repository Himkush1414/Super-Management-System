import { cn } from "@/lib/utils";

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-border bg-bg-subtle text-left text-[11px] uppercase tracking-wide text-text-tertiary">
      {children}
    </thead>
  );
}

export function TH({
  children,
  className,
  numeric,
}: {
  children?: React.ReactNode;
  className?: string;
  numeric?: boolean;
}) {
  return (
    <th
      className={cn(
        "px-4 py-2.5 font-medium",
        numeric && "text-right",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TR({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <tr
      className={cn(
        "border-b border-border last:border-0 transition-colors hover:bg-white/[0.02]",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function TD({
  children,
  className,
  numeric,
}: {
  children?: React.ReactNode;
  className?: string;
  numeric?: boolean;
}) {
  return (
    <td
      className={cn(
        "px-4 py-3 align-middle",
        numeric && "text-right tnum",
        className,
      )}
    >
      {children}
    </td>
  );
}
