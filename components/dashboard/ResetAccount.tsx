"use client";

import { useState, useTransition } from "react";
import { Download, RotateCcw, Trash2 } from "lucide-react";
import { resetAccount, type Result } from "@/lib/actions/admin";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Label } from "@/components/ui/Field";
import { FormAlert } from "@/components/shared/FormAlert";

type ScopeName = "orders" | "stage_events" | "notifications";
type Scope = { name: ScopeName; label: string; note?: string; count: number; defaultOn: boolean };

/**
 * "Delete everything tied to this account" in ONE step: pick what to delete,
 * type the username — and only once it matches are the two ways forward
 * offered: download a copy then delete, or delete straight away. The server
 * re-checks the typed username, and admin_reset_account() re-checks the
 * caller is admin tier.
 */
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
  const [state, setState] = useState<Result | null>(null);
  const [phase, setPhase] = useState<"idle" | "downloading" | "deleting">("idle");
  const [, startTransition] = useTransition();

  const scopes: Scope[] =
    role === "marketing"
      ? [
          { name: "orders", label: "Orders punched", note: "With their stage history and assignments.", count: counts.orders_dispatched, defaultOn: true },
          { name: "notifications", label: "Notifications", count: counts.notifications, defaultOn: true },
        ]
      : [
          { name: "stage_events", label: "Stage updates made", note: "History entries only — the orders keep their current stage.", count: counts.stage_updates, defaultOn: true },
          { name: "notifications", label: "Notifications", count: counts.notifications, defaultOn: true },
          { name: "orders", label: "Orders assigned to this account", note: "Deletes those orders for everyone involved, including marketing.", count: counts.orders_assigned, defaultOn: false },
        ];

  const [on, setOn] = useState<Record<ScopeName, boolean>>(
    Object.fromEntries(scopes.map((s) => [s.name, s.defaultOn])) as Record<ScopeName, boolean>,
  );

  const total = scopes.filter((s) => on[s.name]).reduce((n, s) => n + s.count, 0);
  const confirmed = typed.trim().toLowerCase() === username.toLowerCase();
  const anySelected = scopes.some((s) => on[s.name]);
  const busy = phase !== "idle";

  function remove(exported: boolean) {
    const fd = new FormData();
    fd.set("profile_id", profileId);
    fd.set("confirm", typed);
    for (const s of scopes) if (on[s.name]) fd.set(s.name, "on");
    if (exported) fd.set("exported", "on");
    setPhase("deleting");
    startTransition(async () => {
      const r = await resetAccount(null, fd);
      setState(r);
      setPhase("idle");
      if (r.ok) setOpen(false);
    });
  }

  async function downloadThenDelete() {
    setState(null);
    setPhase("downloading");
    const q = new URLSearchParams({ account: profileId });
    for (const s of scopes) q.set(s.name, on[s.name] ? "1" : "0");
    try {
      const res = await fetch(`/dashboard/data/export?${q}`, { cache: "no-store" });
      if (!res.ok || res.headers.get("content-type") !== "application/pdf") throw new Error();
      const blob = await res.blob();
      const name =
        /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ??
        `nr-archive-${username}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setPhase("idle");
      setState({ error: "The download failed, so nothing was deleted. Try again." });
      return;
    }
    // Only after the copy is safely in the browser's hands.
    remove(true);
  }

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
            setState(null);
            setOpen(true);
          }}
        >
          <RotateCcw size={14} /> Reset data…
        </Button>
      </div>

      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={`Reset ${fullName}'s data?`}
        description="This can't be undone. Every deleted item is recorded, with a copy of what was removed, in the activity log."
      >
        <div className="space-y-4">
          <fieldset className="space-y-2" disabled={busy}>
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
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={busy}
            />
          </div>

          <FormAlert state={open && state?.error ? state : null} />

          {confirmed && anySelected ? (
            <div className="space-y-2 rounded-lg border border-border-strong bg-bg-subtle p-3">
              <p className="text-[12px] text-text-secondary">
                {total} item{total === 1 ? "" : "s"} will be deleted. Choose how to continue:
              </p>
              <div className="grid gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  loading={phase === "downloading"}
                  disabled={busy}
                  onClick={downloadThenDelete}
                >
                  <Download size={14} /> Download this data
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  loading={phase === "deleting"}
                  disabled={busy}
                  onClick={() => remove(false)}
                >
                  <Trash2 size={14} /> Delete this data completely
                </Button>
              </div>
              <p className="text-[11px] text-text-tertiary">
                Download saves a PDF of everything above, then deletes it.
              </p>
            </div>
          ) : (
            <p className="text-[12px] text-text-tertiary">
              {anySelected
                ? "The options to continue appear once the username is typed exactly."
                : "Select at least one kind of data."}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
