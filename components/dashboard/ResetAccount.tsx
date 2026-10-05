"use client";

import { useActionState, useState } from "react";
import { RotateCcw } from "lucide-react";
import { resetAccount, type Result } from "@/lib/actions/admin";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Label } from "@/components/ui/Field";
import { FormAlert } from "@/components/shared/FormAlert";

type Scope = { name: "orders" | "stage_events" | "notifications"; label: string; note?: string; count: number; defaultOn: boolean };

/** "Delete everything tied to this account" — choose scopes, type the username, confirm. */
export function ResetAccount({
  profileId,
  username,
  fullName,
  role,
  counts,
}: {
  profileId: string;
  username: string;
  fullName: string;
  role: "marketing" | "production";
  counts: { orders_dispatched: number; orders_assigned: number; stage_updates: number; notifications: number };
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, action, pending] = useActionState<Result | null, FormData>(
    async (prev, fd) => {
      const r = await resetAccount(prev, fd);
      if (r.ok) setOpen(false);
      return r;
    },
    null,
  );

  const scopes: Scope[] =
    role === "marketing"
      ? [
          { name: "orders", label: "Orders dispatched", note: "With their stage history and assignments.", count: counts.orders_dispatched, defaultOn: true },
          { name: "notifications", label: "Notifications", count: counts.notifications, defaultOn: true },
        ]
      : [
          { name: "stage_events", label: "Stage updates made", note: "History entries only — the orders keep their current stage.", count: counts.stage_updates, defaultOn: true },
          { name: "notifications", label: "Notifications", count: counts.notifications, defaultOn: true },
          { name: "orders", label: "Orders assigned to this account", note: "Deletes those orders for everyone involved, including marketing.", count: counts.orders_assigned, defaultOn: false },
        ];

  const [on, setOn] = useState<Record<string, boolean>>(
    Object.fromEntries(scopes.map((s) => [s.name, s.defaultOn])),
  );

  const total = scopes.filter((s) => on[s.name]).reduce((n, s) => n + s.count, 0);
  const matches = typed.trim().toLowerCase() === username.toLowerCase();
  const anySelected = scopes.some((s) => on[s.name]);

  return (
    <div className="space-y-3">
      <FormAlert state={!open ? state : null} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[13px] font-medium">Reset account data</p>
          <p className="text-[12px] text-text-tertiary">
            Delete everything tied to {fullName} in one action. The account itself stays.
          </p>
        </div>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            setTyped("");
            setOpen(true);
          }}
        >
          <RotateCcw size={14} /> Reset data…
        </Button>
      </div>

      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={`Reset ${fullName}'s data?`}
        description="This can't be undone. Every deleted item is recorded, with a copy of what was removed, in the activity log."
      >
        <form action={action} className="space-y-4">
          <input type="hidden" name="profile_id" value={profileId} />
          <fieldset className="space-y-2">
            <legend className="nr-section-label">Delete</legend>
            {scopes.map((s) => (
              <label
                key={s.name}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-strong bg-bg-subtle px-3 py-2.5 has-[:checked]:border-status-danger/40 has-[:checked]:bg-status-danger/[0.05]"
              >
                <input
                  type="checkbox"
                  name={s.name}
                  checked={on[s.name]}
                  onChange={(e) => setOn((p) => ({ ...p, [s.name]: e.target.checked }))}
                  className="mt-0.5 size-4 accent-[var(--status-danger)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2 text-[13px] font-medium">
                    {s.label}
                    <span className="tnum text-text-secondary">{s.count}</span>
                  </span>
                  {s.note && <span className="mt-0.5 block text-[12px] text-text-tertiary">{s.note}</span>}
                </span>
              </label>
            ))}
          </fieldset>

          <div>
            <Label htmlFor="confirm-reset">
              Type <span className="font-mono text-text">{username}</span> to confirm
            </Label>
            <Input
              id="confirm-reset"
              name="confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>

          <FormAlert state={open && state?.error ? state : null} />

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              className="w-full sm:w-auto"
              loading={pending}
              disabled={!matches || !anySelected}
            >
              Delete {total} item{total === 1 ? "" : "s"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
