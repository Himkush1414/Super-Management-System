"use client";

import { useState, useTransition } from "react";
import { X, Plus } from "lucide-react";
import { assignMaker, unassignUser } from "@/lib/actions/projects";
import { RoleBadge } from "@/components/shared/Badge";
import { Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import type { Profile, ProjectAssignment } from "@/types/database.types";

type Row = ProjectAssignment & {
  profiles: Pick<Profile, "id" | "full_name" | "role"> | null;
};

export function AssignmentsPanel({
  projectId,
  assignments,
  canManage,
  staff,
}: {
  projectId: string;
  assignments: Row[];
  canManage: boolean;
  staff: Pick<Profile, "id" | "full_name" | "role">[];
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState("");

  const assignedIds = new Set(assignments.map((a) => a.user_id));
  const available = staff.filter((s) => !assignedIds.has(s.id));

  return (
    <div className="space-y-2">
      {assignments.length === 0 && (
        <p className="text-[12px] text-text-tertiary">No supervisors or makers assigned.</p>
      )}
      {assignments.map((a) => (
        <div
          key={a.id}
          className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[13px]"
        >
          <span className="flex items-center gap-2">
            {a.profiles?.full_name ?? "Unknown"}
            {a.profiles && <RoleBadge role={a.profiles.role} />}
          </span>
          {canManage && (
            <button
              onClick={() =>
                start(async () => {
                  const r = await unassignUser(projectId, a.user_id);
                  setErr(r.error ?? null);
                })
              }
              disabled={pending}
              className="text-text-tertiary hover:text-status-danger"
              aria-label="Remove"
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}

      {canManage && available.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <Select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="flex-1"
          >
            <option value="">Add maker…</option>
            {available.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name} ({s.role.replace(/_/g, " ")})
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="secondary"
            disabled={!pick || pending}
            onClick={() =>
              start(async () => {
                const r = await assignMaker(projectId, pick);
                setErr(r.error ?? null);
                if (!r.error) setPick("");
              })
            }
          >
            <Plus size={14} />
          </Button>
        </div>
      )}
      {err && <p className="text-[12px] text-status-danger">{err}</p>}
    </div>
  );
}
