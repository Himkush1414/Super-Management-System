/**
 * lib/permissions.ts — single source of truth for the role model.
 *
 * Four roles. `marketing` and `production` are each held by several fixed
 * accounts (marketing1..4, production1..4); individual scoping (an account
 * only sees its own orders) is enforced by RLS on `created_by` / `assigned_to`,
 * not by the role.
 *
 * head_admin invisibility (original spec §2): the role exists, but nothing
 * user-facing — no label, badge, dropdown, nav item, or audit row — ever
 * reveals it to another role. `admin` believes it is the top level.
 */

export const ROLES = ["head_admin", "admin", "marketing", "production"] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | "orders.dispatch" // create an order (marketing)
  | "orders.viewOwn" // see orders you dispatched (marketing)
  | "orders.viewAssigned" // see orders assigned to you (production)
  | "orders.viewAll" // see every order (admin tier)
  | "orders.advanceStage" // move an assigned order to the next stage (production)
  | "price.view" // see the price field
  | "production.settings" // register a production phone number
  | "roster.viewAll"; // resolve every account's name (admin tier)

const T = true;
type Caps = Partial<Record<Permission, boolean>>;

const MATRIX: Record<Role, Caps> = {
  head_admin: {
    "orders.viewAll": T,
    "price.view": T,
    "roster.viewAll": T,
  },
  admin: {
    "orders.viewAll": T,
    "price.view": T,
    "roster.viewAll": T,
  },
  marketing: {
    "orders.dispatch": T,
    "orders.viewOwn": T,
    "price.view": T, // their own orders only — enforced by RLS/order_feed
  },
  production: {
    "orders.viewAssigned": T,
    "orders.advanceStage": T,
    "production.settings": T,
  },
};

export function can(role: Role | null | undefined, perm: Permission): boolean {
  if (!role) return false;
  return MATRIX[role]?.[perm] ?? false;
}

export const isAdminTier = (role: Role | null | undefined): boolean =>
  role === "head_admin" || role === "admin";

/**
 * Where a role lands after login / when it hits a route it can't use.
 * Everyone goes to the orders list; it renders the right view per role.
 */
export const HOME_PATH = "/dashboard/orders";
