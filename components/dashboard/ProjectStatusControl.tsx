"use client";

import { useState, useTransition } from "react";
import { updateProjectStatus } from "@/lib/actions/projects";
import { PROJECT_STATUSES, type ProjectStatus } from "@/lib/permissions";
import { Select } from "@/components/ui/Field";

export function ProjectStatusControl({
  projectId,
  current,
}: {
  projectId: string;
  current: ProjectStatus;
}) {
  const [value, setValue] = useState<ProjectStatus>(current);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      <label className="text-[13px] text-text-secondary">Project status</label>
      <Select
        className="w-48"
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as ProjectStatus;
          setValue(next);
          start(async () => {
            const r = await updateProjectStatus(projectId, next);
            if (r.error) {
              setErr(r.error);
              setValue(current);
            } else setErr(null);
          });
        }}
      >
        {PROJECT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, " ")}
          </option>
        ))}
      </Select>
      {pending && <span className="text-[12px] text-text-tertiary">Saving…</span>}
      {err && <span className="text-[12px] text-status-danger">{err}</span>}
    </div>
  );
}
