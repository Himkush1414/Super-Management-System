"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { Logo } from "@/components/public/Logo";
import { RoleBadge } from "@/components/shared/Badge";
import { NAV_ITEMS } from "./nav-items";
import { can, type Role } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/utils";

const SECTION_LABEL: Record<string, string | null> = {
  main: null,
  admin: "Administration",
  account: null,
};

function NavList({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = usePathname();
  const visible = NAV_ITEMS.filter((i) => !i.perm || can(role, i.perm));

  return (
    <nav className="flex-1 space-y-0.5 px-3 py-3">
      {visible.map((item, i) => {
        const prevSection = i === 0 ? "" : visible[i - 1].section;
        const newSection = item.section !== prevSection;
        const showDivider = newSection && i !== 0;
        const label = SECTION_LABEL[item.section];
        const active =
          pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <div key={item.href}>
            {showDivider && <div className="my-2 border-t border-border" />}
            {newSection && label && (
              <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
                {label}
              </p>
            )}
            <Link
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-medium transition-colors",
                active
                  ? "bg-white/[0.07] text-text"
                  : "text-text-secondary hover:bg-white/[0.04] hover:text-text",
              )}
            >
              <item.icon size={16} strokeWidth={1.75} />
              {item.label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}

function UserFooter({ name, role }: { name: string; role: Role }) {
  return (
    <div className="flex items-center gap-2.5 border-t border-border px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-elevated text-[12px] font-medium">
        {initials(name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{name}</p>
        <div className="mt-0.5">
          <RoleBadge role={role} />
        </div>
      </div>
    </div>
  );
}

export function Sidebar({
  role,
  name,
  mobileOpen,
  onClose,
}: {
  role: Role;
  name: string;
  mobileOpen: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {/* desktop rail */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-bg-subtle">
        <div className="flex h-14 items-center px-4">
          <Link href="/dashboard/overview" className="text-text">
            <Logo />
          </Link>
        </div>
        <NavList role={role} />
        <UserFooter name={name} role={role} />
      </aside>

      {/* mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 z-40 bg-black/60 md:hidden"
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "tween", duration: 0.22 }}
              className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-bg-subtle md:hidden"
            >
              <div className="flex h-14 items-center justify-between px-4">
                <Logo />
                <button
                  onClick={onClose}
                  className="inline-flex size-8 items-center justify-center rounded-lg text-text-secondary hover:bg-white/[0.06]"
                  aria-label="Close menu"
                >
                  <X size={16} />
                </button>
              </div>
              <NavList role={role} onNavigate={onClose} />
              <UserFooter name={name} role={role} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
