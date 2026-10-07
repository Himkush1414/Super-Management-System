"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { Logo } from "@/components/shared/Logo";
import { NAV_ITEMS } from "./nav-items";
import { can, type Role } from "@/lib/permissions";
import { cn, initials } from "@/lib/utils";

/** Thin shimmer under the label while the clicked route is still loading. */
function PendingHint() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={cn(
        "ml-auto size-1.5 rounded-full bg-accent transition-opacity",
        pending ? "animate-pulse opacity-100" : "opacity-0",
      )}
    />
  );
}

function NavList({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = usePathname();
  const visible = NAV_ITEMS.filter(
    (i) => (!i.perm || can(role, i.perm)) && (!i.roles || i.roles.includes(role)),
  );

  return (
    <nav className="flex-1 space-y-0.5 px-3 py-3">
      {visible.map((item) => {
        const active =
          item.href === "/dashboard/orders"
            ? pathname === item.href ||
              (pathname.startsWith("/dashboard/orders/") &&
                pathname !== "/dashboard/orders/new")
            : pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "nr-interactive flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium hover:translate-x-0.5",
              active
                ? "bg-white/[0.08] text-text"
                : "text-text-secondary hover:bg-white/[0.04] hover:text-text",
            )}
          >
            <item.icon size={16} strokeWidth={1.75} />
            {item.label}
            <PendingHint />
          </Link>
        );
      })}
    </nav>
  );
}

// Admin-tier accounts get no role caption: nothing user-facing may hint
// that a level above "admin" exists (head_admin invisibility).
const ROLE_CAPTION: Partial<Record<Role, string>> = {
  marketing: "Marketing",
  production: "Production",
  dispatcher: "Dispatcher",
};

function UserFooter({ name, role, caption }: { name: string; role: Role; caption?: string }) {
  return (
    <div className="flex items-center gap-2.5 border-t border-border px-4 py-3.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border-strong bg-elevated text-[12px] font-medium">
        {initials(name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium leading-tight">{name}</p>
        {(caption ?? ROLE_CAPTION[role]) && (
          <p className="truncate text-[11px] leading-tight text-text-tertiary">{caption ?? ROLE_CAPTION[role]}</p>
        )}
      </div>
    </div>
  );
}

export function Sidebar({
  role,
  name,
  caption,
  mobileOpen,
  onClose,
}: {
  role: Role;
  name: string;
  caption?: string;
  mobileOpen: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-bg-subtle">
        <div className="flex h-14 items-center px-4 text-text">
          <Logo />
        </div>
        <NavList role={role} />
        <UserFooter name={name} role={role} caption={caption} />
      </aside>

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
              <div className="flex h-14 items-center justify-between px-4 text-text">
                <Logo />
                <button
                  onClick={onClose}
                  className="nr-interactive inline-flex size-8 items-center justify-center rounded-lg text-text-secondary hover:bg-white/[0.06]"
                  aria-label="Close menu"
                >
                  <X size={16} />
                </button>
              </div>
              <NavList role={role} onNavigate={onClose} />
              <UserFooter name={name} role={role} caption={caption} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
