import {
  Package,
  Settings,
  PlusCircle,
  DatabaseZap,
  Boxes,
  SlidersHorizontal,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import type { Permission, Role } from "@/lib/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  perm?: Permission;
  roles?: Role[];
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard/orders",
    label: "Orders",
    icon: Package,
    roles: ["head_admin", "admin", "marketing", "production"],
  },
  {
    href: "/dashboard/orders/new",
    label: "Punch Order",
    icon: PlusCircle,
    perm: "orders.punch",
  },
  {
    href: "/dashboard/data",
    label: "Data management",
    icon: DatabaseZap,
    perm: "data.delete",
  },
  {
    href: "/dashboard/activity",
    label: "Activity log",
    icon: ScrollText,
    perm: "audit.view",
  },
  {
    href: "/dashboard/settings",
    label: "Settings",
    icon: Settings,
    perm: "profile.edit",
  },
  {
    href: "/dashboard/inventory",
    label: "Inventory",
    icon: Boxes,
    perm: "inventory.view",
  },
  {
    href: "/dashboard/inventory-settings",
    label: "Inventory settings",
    icon: SlidersHorizontal,
    perm: "inventory.manage",
  },
];
