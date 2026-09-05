"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { reviewSignup } from "@/lib/actions/admin";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { ASSIGNABLE_ROLES, ROLE_LABEL, type Role } from "@/lib/permissions";

/** Head-Admin-exclusive: approval and role assignment happen as one action
 * (spec §2/§3). head_admin is never an option — it's seeded once, never granted. */
export function HeadAdminReview({ requestId }: { requestId: string }) {
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [role, setRole] = useState<Role>(ASSIGNABLE_ROLES[0]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function approve() {
    start(async () => {
      const r = await reviewSignup(requestId, "approved", role);
      if (r.error) setErr(r.error);
    });
  }

  function reject() {
    start(async () => {
      const r = await reviewSignup(requestId, "rejected", undefined, note || undefined);
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
          <Button size="sm" variant="danger" loading={pending} onClick={reject}>
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
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {err && <p className="text-[12px] text-status-danger">{err}</p>}
      <Select
        className="h-8 w-44 text-[12px]"
        value={role}
        disabled={pending}
        onChange={(e) => setRole(e.target.value as Role)}
      >
        {ASSIGNABLE_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </Select>
      <Button size="sm" variant="outline" onClick={() => setRejecting(true)} disabled={pending}>
        <X size={14} /> Reject
      </Button>
      <Button size="sm" loading={pending} onClick={approve}>
        <Check size={14} /> Approve
      </Button>
    </div>
  );
}
