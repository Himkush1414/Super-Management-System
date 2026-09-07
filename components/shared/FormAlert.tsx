import { AlertCircle, CheckCircle2 } from "lucide-react";

export function FormAlert({
  state,
}: {
  state: { error?: string; ok?: string } | null | undefined;
}) {
  if (!state?.error && !state?.ok) return null;
  const isError = Boolean(state.error);
  return (
    <div
      role="alert"
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
