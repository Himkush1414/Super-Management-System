"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { reviewSignup } from "@/lib/actions/admin";
import { Button } from "@/components/ui/Button";

export function ApprovalActions({ requestId }: { requestId: string }) {
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function act(decision: "approved" | "rejected") {
    start(async () => {
      const r = await reviewSignup(requestId, decision, note || undefined);
      if (r.error) setErr(r.error);
    });
  }

  if (rejecting) {
    return (
      <div className="flex w-full flex-col gap-2 sm:w-80">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason (shown to the user)"
          className="h-8 rounded-lg border border-border-strong bg-bg-subtle px-2.5 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        />
        <div className="flex gap-2">
          <Button size="sm" variant="danger" loading={pending} onClick={() => act("rejected")}>
            Confirm reject
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
        </div>
        {err && <p className="text-[12px] text-status-danger">{err}</p>}
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {err && <p className="text-[12px] text-status-danger">{err}</p>}
      <Button size="sm" variant="outline" onClick={() => setRejecting(true)} disabled={pending}>
        <X size={14} /> Reject
      </Button>
      <Button size="sm" loading={pending} onClick={() => act("approved")}>
        <Check size={14} /> Approve
      </Button>
    </div>
  );
}
