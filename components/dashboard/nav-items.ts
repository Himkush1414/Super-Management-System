import {
  LayoutGrid,
  FolderKanban,
  UserCheck,
  Users,
  ScrollText,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  perm?: Permission;
  section: "main" | "admin" | "account";
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard/overview", label: "Overview", icon: LayoutGrid, section: "main" },
  { href: "/dashboard/projects", label: "Projects", icon: FolderKanban, section: "main" },
  {
    href: "/dashboard/approvals",
    label: "Approvals",
    icon: UserCheck,
    perm: "approvals.manage",
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
