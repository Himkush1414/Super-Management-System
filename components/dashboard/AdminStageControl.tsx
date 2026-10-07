"use client";

import { useState, useTransition } from "react";
import { ArrowRight } from "lucide-react";
import { setStage } from "@/lib/actions/orders";
import { MAX_STAGE, STAGES, stageName } from "@/lib/orders";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { FormAlert } from "@/components/shared/FormAlert";

/**
 * Admin / head_admin: move the order to the next stage — or to any other
 * stage, forward or back — with no timer, no dispatch step and no status
 * check. Every move asks for confirmation first.
 */
export function AdminStageControl({ orderId, stage }: { orderId: string; stage: number }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ error?: string; ok?: string } | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [other, setOther] = useState("");

  const next = stage < MAX_STAGE ? stage + 1 : null;

  function confirmMove() {
    const to = target;
    setTarget(null);
    if (to === null) return;
    // No router.refresh(): the action's response carries the re-rendered page.
    start(async () => {
      setState(await setStage(orderId, stage, to));
      setOther("");
    });
  }

  return (
    <div className="space-y-3">
      <FormAlert state={state} />
      {next !== null && (
        <Button loading={pending && target === null} onClick={() => setTarget(next)}>
          Advance to Stage {next} — {stageName(next)}
          <ArrowRight size={15} />
        </Button>
      )}
      <div className="flex items-center gap-2">
        <Select
          value={other}
          onChange={(e) => setOther(e.target.value)}
          aria-label="Move to another stage"
          className="sm:max-w-[240px]"
        >
          <option value="">Move to another stage…</option>
          {STAGES.filter((s) => s.n !== stage && s.n !== next).map((s) => (
            <option key={s.n} value={String(s.n)}>
              Stage {s.n} — {s.name}
            </option>
          ))}
        </Select>
        <Button variant="secondary" disabled={!other || pending} onClick={() => setTarget(Number(other))}>
          Move
        </Button>
      </div>
      <p className="text-[12px] text-text-tertiary">
        Admin: any stage, no timer, no dispatch step. Marketing and production are notified.
      </p>

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={
          target === next
            ? "Are you sure you want to advance this order to the next stage?"
            : `Are you sure you want to move this order to Stage ${target} — ${stageName(target ?? 1)}?`
        }
        description={`It moves from Stage ${stage} — ${stageName(stage)} to Stage ${target} — ${stageName(target ?? 1)} right away.${
          target === 1 ? " It goes back to the dispatchers for review." : ""
        }`}
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onClick={() => setTarget(null)}>
            Cancel
          </Button>
          <Button className="w-full sm:w-auto" loading={pending} onClick={confirmMove}>
            {target === next ? "Yes, advance" : "Yes, move"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
