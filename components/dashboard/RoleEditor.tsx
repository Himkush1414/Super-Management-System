"use client";

import { useState, useTransition } from "react";
import { changeUserRole } from "@/lib/actions/admin";
import { ASSIGNABLE_ROLES, ROLE_LABEL, type Role } from "@/lib/permissions";
import { Select } from "@/components/ui/Field";

export function RoleEditor({
  userId,
  current,
  disabled,
}: {
  userId: string;
  current: Role;
  disabled?: boolean;
}) {
  const [role, setRole] = useState<Role>(current);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (disabled) {
    return <span className="text-[13px] text-text-secondary">{ROLE_LABEL[current]}</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        className="h-8 w-44 text-[12px]"
        value={role}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as Role;
          setRole(next);
          start(async () => {
            const r = await changeUserRole(userId, next);
            if (r.error) {
              setErr(r.error);
              setRole(current);
            } else setErr(null);
          });
        }}
      >
        {ASSIGNABLE_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </Select>
      {pending && <span className="text-[11px] text-text-tertiary">…</span>}
      {err && <span className="text-[11px] text-status-danger">{err}</span>}
    </div>
  );
}
