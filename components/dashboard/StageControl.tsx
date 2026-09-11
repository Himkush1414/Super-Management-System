"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { advanceStage } from "@/lib/actions/orders";
import { MAX_STAGE, stageName } from "@/lib/orders";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { FormAlert } from "@/components/shared/FormAlert";

export function StageControl({
  orderId,
  stage,
  waiting,
  stageReadyAt,
}: {
  orderId: string;
  stage: number;
  waiting: boolean;
  /** Null once the post-confirmation timer has elapsed (or never started). */
  stageReadyAt: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ error?: string; ok?: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const target = !waiting && stageReadyAt ? new Date(stageReadyAt).getTime() : null;

  // `now` starts correct via the lazy useState initializer (runs once, on
  // mount) and afterwards is only ever updated from the interval callback —
  // the render body itself never calls the impure Date.now() directly.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  const counting = Boolean(target && target > now);

  if (waiting) {
    return (
      <p className="text-[13px] text-text-secondary">
        This order can&apos;t start until a production phone number is registered.
        Add yours in <span className="font-medium text-text">Settings</span>.
      </p>
    );
  }

  if (stage >= MAX_STAGE) {
    return (
      <p className="text-[13px] text-status-success">
        Delivered — this order is complete.
      </p>
    );
  }

  if (counting) {
    return (
      <p className="text-[13px] text-text-secondary">
        The next stage unlocks when the timer above reaches zero.
      </p>
    );
  }

  const next = stage + 1;

  function confirmAdvance() {
    setConfirmOpen(false);
    start(async () => {
      const r = await advanceStage(orderId);
      setState(r);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <FormAlert state={state} />
      <Button loading={pending} onClick={() => setConfirmOpen(true)}>
        Advance to Stage {next} — {stageName(next)}
        <ArrowRight size={15} />
      </Button>
      <p className="text-[12px] text-text-tertiary">
        Marketing is notified on every stage change.
      </p>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Move to the next step?"
        description={`Stage ${next} — ${stageName(next)} starts right away. After that, the following stage opens after 3 minutes.`}
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            className="w-full sm:w-auto"
            onClick={() => setConfirmOpen(false)}
          >
            Cancel
          </Button>
          <Button className="w-full sm:w-auto" loading={pending} onClick={confirmAdvance}>
            Yes, advance
          </Button>
        </div>
      </Modal>
    </div>
  );
}
