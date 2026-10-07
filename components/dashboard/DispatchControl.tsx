"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Send } from "lucide-react";
import { dispatchToProduction, startReview } from "@/lib/actions/orders";
import { stageName } from "@/lib/orders";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { FormAlert } from "@/components/shared/FormAlert";

/**
 * Dispatcher, Stage 1 (Dispatch review). Opening the order marks it
 * "Verification in progress" (once); "Dispatch to production" moves it to
 * Stage 2 — only when every assigned production member has a phone linked.
 */
export function DispatchControl({
  orderId,
  stage,
  waiting,
  reviewStarted,
  dispatchedBy,
}: {
  orderId: string;
  stage: number;
  waiting: boolean;
  reviewStarted: boolean;
  /** who moved it out of Stage 1, when known */
  dispatchedBy: string | null;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ error?: string; ok?: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Mark "Verification in progress" when a dispatcher actually views it
  // (not on link prefetch). Once per mount; the server ignores repeats.
  const marked = useRef(false);
  useEffect(() => {
    if (stage !== 1 || reviewStarted || marked.current) return;
    marked.current = true;
    startReview(orderId);
  }, [orderId, stage, reviewStarted]);

  if (stage !== 1) {
    return (
      <div className="space-y-2">
        <FormAlert state={state} />
        <p className="text-[13px] text-text-secondary">
          Dispatched to production{dispatchedBy ? ` by ${dispatchedBy}` : ""}. Now at Stage {stage} —{" "}
          {stageName(stage)}.
        </p>
      </div>
    );
  }

  function confirmDispatch() {
    setConfirmOpen(false);
    start(async () => {
      setState(await dispatchToProduction(orderId));
    });
  }

  return (
    <div className="space-y-3">
      <FormAlert state={state} />
      <Button loading={pending} disabled={waiting} onClick={() => setConfirmOpen(true)}>
        <Send size={14} /> Dispatch to production
      </Button>
      <p className="text-[12px] text-text-tertiary">
        {waiting
          ? "Can't be dispatched yet: an assigned production member hasn't linked a phone number."
          : "Check the product details first. Production can start as soon as it's dispatched."}
      </p>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Dispatch this order to production?"
        description={`It moves to Stage 2 — ${stageName(2)} right away and production can start work.`}
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button className="w-full sm:w-auto" loading={pending} onClick={confirmDispatch}>
            Yes, dispatch
          </Button>
        </div>
      </Modal>
    </div>
  );
}
