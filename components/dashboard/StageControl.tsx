"use client";

import { useState, useTransition } from "react";
import { ArrowRight } from "lucide-react";
import { advanceStage } from "@/lib/actions/orders";
import { MAX_STAGE, stageName } from "@/lib/orders";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/shared/FormAlert";

export function StageControl({
  orderId,
  stage,
  waiting,
}: {
  orderId: string;
  stage: number;
  waiting: boolean;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ error?: string; ok?: string } | null>(null);

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

  const next = stage + 1;

  return (
    <div className="space-y-3">
      <FormAlert state={state} />
      <Button
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await advanceStage(orderId);
            setState(r);
          })
        }
      >
        Advance to Stage {next} — {stageName(next)}
        <ArrowRight size={15} />
      </Button>
      <p className="text-[12px] text-text-tertiary">
        Marketing is notified on every stage change.
      </p>
    </div>
  );
}
