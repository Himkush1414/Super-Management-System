/**
 * lib/permissions.ts — single source of truth for the role model.
 *
 * Four roles. `marketing` and `production` are each held by several fixed
 * accounts (marketing1..4, production1..4); individual scoping (an account
 * only sees its own orders) is enforced by RLS on `orders.created_by` /
 * `order_assignees`, not by the role.
 *
 * The database enforces the same rules independently (RLS + SECURITY DEFINER
 * checks) — this matrix decides what the UI offers and is re-checked in every
 * server action; it is never the only gate. `data.delete` ↔ the
 * orders_admin_delete / ose_admin_delete policies and admin_reset_account()
 * (migration 0013); `audit.view` ↔ the audit_log_select policy.
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
  | "orders.overrideStage" // move ANY order to the next stage, no timer (admin tier, after a confirmation)
  | "price.view" // see the price field
  | "production.settings" // register a production phone number
  | "profile.edit" // set your real name (marketing, production)
  | "roster.viewAll" // resolve every account's name (admin tier)
  | "data.delete" // delete orders / stage updates / reset a marketing or production account's data (admin tier)
  | "audit.view"; // read the deletion audit trail (admin tier; head_admin's own rows only to head_admin)

const T = true;
type Caps = Partial<Record<Permission, boolean>>;

const MATRIX: Record<Role, Caps> = {
  head_admin: {
    "orders.viewAll": T,
    "orders.overrideStage": T,
    "price.view": T,
    "roster.viewAll": T,
    "data.delete": T,
    "audit.view": T,
  },
  admin: {
    "orders.viewAll": T,
    "orders.overrideStage": T,
    "price.view": T,
    "roster.viewAll": T,
    "data.delete": T,
    "audit.view": T,
  },
  marketing: {
    "orders.dispatch": T,
    "orders.viewOwn": T,
    "price.view": T, // their own orders only — enforced by RLS/order_feed
    "profile.edit": T,
  },
  production: {
    "orders.viewAssigned": T,
    "orders.advanceStage": T,
    "production.settings": T,
    "profile.edit": T,
  },
};

export function can(role: Role | null | undefined, perm: Permission): boolean {
  if (!role) return false;
  return MATRIX[role]?.[perm] ?? false;
}

export const isAdminTier = (role: Role | null | undefined): boolean =>
  role === "head_admin" || role === "admin";
