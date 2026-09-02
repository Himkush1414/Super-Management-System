import { AlertCircle, CheckCircle2 } from "lucide-react";

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-panel/70 p-6 backdrop-blur-sm nr-fade-in">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      {subtitle && (
        <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
          {subtitle}
        </p>
      )}
      <div className="mt-5">{children}</div>
      {footer && (
        <div className="mt-5 border-t border-border pt-4 text-center text-[13px] text-text-secondary">
          {footer}
        </div>
      )}
    </div>
  );
}

export function FormAlert({ state }: { state: { error?: string; ok?: string } | null }) {
  if (!state?.error && !state?.ok) return null;
  const isError = Boolean(state.error);
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border p-3 text-[13px] ${
        isError
          ? "border-status-danger/30 bg-status-danger/10 text-status-danger"
          : "border-status-success/30 bg-status-success/10 text-status-success"
      }`}
    >
      {isError ? (
        <AlertCircle size={15} className="mt-0.5 shrink-0" />
      ) : (
        <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
      )}
      <span>{state.error ?? state.ok}</span>
    </div>
  );
}
