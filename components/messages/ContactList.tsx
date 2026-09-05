"use client";

import { RoleBadge } from "@/components/shared/Badge";
import { initials, cn } from "@/lib/utils";
import type { Profile } from "@/types/database.types";

export function ContactList({
  contacts,
  selectedId,
  onSelect,
}: {
  contacts: Profile[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {contacts.length === 0 && (
        <p className="p-4 text-center text-[13px] text-text-tertiary">
          No other users yet.
        </p>
      )}
      {contacts.map((c) => (
        <button
          key={c.id}
          onClick={() => onSelect(c.id)}
          className={cn(
            "nr-interactive flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left",
            selectedId === c.id ? "bg-white/[0.06]" : "hover:bg-white/[0.03]",
          )}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-elevated text-[12px] font-medium">
            {initials(c.full_name || "?")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{c.full_name || "Unnamed"}</p>
            <div className="mt-0.5">
              <RoleBadge role={c.role} />
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
