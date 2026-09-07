import { Package, Settings, PlusCircle, type LucideIcon } from "lucide-react";
import type { Permission, Role } from "@/lib/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  perm?: Permission;
  roles?: Role[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard/orders", label: "Orders", icon: Package },
  {
    href: "/dashboard/orders/new",
    label: "Dispatch order",
    icon: PlusCircle,
    perm: "orders.dispatch",
  },
  {
    href: "/dashboard/settings",
    label: "Settings",
    icon: Settings,
    perm: "production.settings",
  },
];
