import {
  LayoutGrid,
  FolderKanban,
  UserCheck,
  Users,
  ScrollText,
  Settings,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import type { Permission, Role } from "@/lib/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  perm?: Permission;
  /** Restrict to specific roles regardless of perm (used where two roles
   * share a permission but should land on different routes, or where a
   * feature is role-specific rather than permission-specific). */
  roles?: Role[];
  section: "main" | "admin" | "account";
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard/overview", label: "Overview", icon: LayoutGrid, section: "main" },
  { href: "/dashboard/projects", label: "Projects", icon: FolderKanban, section: "main" },
  {
    href: "/dashboard/messages",
    label: "Messages",
    icon: MessageSquare,
    roles: ["admin", "manager", "product_supervisor", "maker"],
    section: "main",
  },
  {
    href: "/dashboard/approvals",
    label: "Approvals",
    icon: UserCheck,
    perm: "approvals.view",
    roles: ["admin"],
    section: "admin",
  },
  {
    href: "/dashboard/approvals/review",
    label: "Approvals",
    icon: UserCheck,
    perm: "approvals.decide",
    roles: ["head_admin"],
    section: "admin",
  },
  {
    href: "/dashboard/users",
    label: "Users",
    icon: Users,
    perm: "users.changeRole",
    section: "admin",
  },
  {
    href: "/dashboard/audit-log",
    label: "Audit log",
    icon: ScrollText,
    perm: "audit.view",
    section: "admin",
  },
  { href: "/dashboard/settings", label: "Settings", icon: Settings, section: "account" },
];
