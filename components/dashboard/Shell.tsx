"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, LogOut, ChevronRight } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { NotificationsBell } from "./NotificationsBell";
import { signOutAction } from "@/lib/auth/actions";
import type { Role } from "@/lib/permissions";

const CRUMB_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  overview: "Overview",
  projects: "Projects",
  approvals: "Approvals",
  users: "Users",
  "audit-log": "Audit log",
  settings: "Settings",
  chat: "Chat",
};

function Breadcrumbs() {
  const parts = usePathname().split("/").filter(Boolean);
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
      {parts.map((p, i) => {
        const href = "/" + parts.slice(0, i + 1).join("/");
        const isLast = i === parts.length - 1;
        const label =
          CRUMB_LABELS[p] ??
          (p.length > 14 ? p.slice(0, 8) + "…" : p.replace(/-/g, " "));
        return (
          <span key={href} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={13} className="text-text-tertiary" />}
            {isLast ? (
              <span className="truncate font-medium text-text">{label}</span>
            ) : (
              <Link href={href} className="text-text-secondary hover:text-text">
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </div>
  );
}

export function Shell({
  role,
  name,
  userId,
  initialUnread,
  children,
}: {
  role: Role;
  name: string;
  userId: string;
  initialUnread: number;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar
        role={role}
        name={name}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur">
          <button
            onClick={() => setMobileOpen(true)}
            className="inline-flex size-8 items-center justify-center rounded-lg text-text-secondary hover:bg-white/[0.06] md:hidden"
            aria-label="Open menu"
          >
            <Menu size={16} />
          </button>
          <Breadcrumbs />
          <div className="ml-auto flex items-center gap-1.5">
            <NotificationsBell userId={userId} initialUnread={initialUnread} />
            <form action={signOutAction}>
              <button
                type="submit"
                className="inline-flex size-8 items-center justify-center rounded-lg text-text-secondary hover:bg-white/[0.06] hover:text-text"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut size={15} />
              </button>
            </form>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
