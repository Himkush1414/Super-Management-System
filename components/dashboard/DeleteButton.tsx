"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteOrder, deleteStageEvent, type Result } from "@/lib/actions/admin";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { FormAlert } from "@/components/shared/FormAlert";

/**
 * Delete one order or one stage update, behind a confirmation dialog that
 * spells out exactly what will be removed. Admin tier only — the server
 * action and RLS re-check that regardless of who renders this.
 */
export function DeleteButton({
  kind,
  id,
  title,
  lines,
  redirectTo,
  compact,
}: {
  kind: "order" | "stage_event";
  id: string;
  /** What is being deleted, e.g. the product name. */
  title: string;
  /** Extra facts shown in the dialog so the admin knows what they're removing. */
  lines?: string[];
  /** After a successful delete, navigate here (e.g. away from a deleted order's page). */
  redirectTo?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [state, setState] = useState<Result | null>(null);

  const noun = kind === "order" ? "order" : "stage update";

  function confirm() {
    start(async () => {
      const r =
        kind === "order" ? await deleteOrder(id, { redirectTo }) : await deleteStageEvent(id);
      setState(r);
      if (r.ok) setOpen(false);
    });
  }

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={() => {
            setState(null);
            setOpen(true);
          }}
          className="nr-interactive inline-flex size-8 items-center justify-center rounded-lg text-text-tertiary hover:bg-status-danger/10 hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger/50"
          aria-label={`Delete ${noun}: ${title}`}
          title={`Delete ${noun}`}
        >
          <Trash2 size={15} />
        </button>
      ) : (
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            setState(null);
            setOpen(true);
          }}
        >
          <Trash2 size={14} /> Delete {noun}
        </Button>
      )}
      {state?.ok && !open && <span className="sr-only" role="status">{state.ok}</span>}

      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={`Delete this ${noun}?`}
        description="This can't be undone. The deletion and a copy of what was removed are recorded in the activity log."
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-status-danger/25 bg-status-danger/[0.06] p-3">
            <p className="text-[13px] font-medium text-text">{title}</p>
            {lines?.map((l) => (
              <p key={l} className="mt-0.5 text-[12px] text-text-secondary">
                {l}
              </p>
            ))}
          </div>
          <FormAlert state={state?.error ? state : null} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" className="w-full sm:w-auto" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" className="w-full sm:w-auto" loading={pending} onClick={confirm}>
              Delete {noun}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
