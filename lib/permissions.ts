/**
 * lib/permissions.ts
 * ------------------------------------------------------------------
 * THE single source of truth for the NR Industries role/permission
 * matrix (see spec §1). Every UI conditional and every API route MUST
 * import from here. The Postgres RLS policies in
 * supabase/migrations/ mirror this exact table — if you change a rule
 * here, change the matching policy there in the same commit.
 * ------------------------------------------------------------------
 */

export const ROLES = [
  "head_admin",
  "admin",
  "manager",
  "product_supervisor",
  "maker",
] as const;

export type Role = (typeof ROLES)[number];

/** Roles a person may request for themselves at sign-up. */
export const SELF_SELECTABLE_ROLES: Role[] = [
  "manager",
  "product_supervisor",
  "maker",
];

export const ROLE_LEVEL: Record<Role, number> = {
  head_admin: 4,
  admin: 3,
  manager: 2,
  product_supervisor: 2,
  maker: 1,
};

export const ROLE_LABEL: Record<Role, string> = {
  head_admin: "Head Admin",
  admin: "Admin",
  manager: "Manager",
  product_supervisor: "Product Supervisor",
  maker: "Maker",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  head_admin: "Full control. Sole role-changer and permission authorizer.",
  admin: "Full visibility. Approves signups. Cannot change roles.",
  manager: "Assigned projects with pricing. Assigns work to Makers.",
  product_supervisor:
    "Assigned projects — specs & quality. Pricing is restricted.",
  maker: "Own assigned tasks only. Never sees pricing.",
};

/** Every gated capability in the system. */
export type Permission =
  | "projects.view" // see projects (scoped by assignment for L1–L2)
  | "projects.viewAll" // see every project regardless of assignment
  | "projects.create" // create a new project / order
  | "pricing.view" // see price / cost fields
  | "pricing.edit" // edit price / cost fields
  | "specs.view" // see production specs / requirements
  | "specs.edit" // edit specs / requirements / quality fields
  | "tasks.updateOwn" // move status on own assigned tasks
  | "tasks.assign" // assign / reassign Makers to tasks
  | "approvals.manage" // approve / reject signup requests
  | "users.changeRole" // change another user's role
  | "permissions.edit" // edit the permission matrix itself
  | "audit.view" // read the audit log
  | "pdf.generate" // generate a spec-sheet PDF
  | "chat.access"; // access project chat threads

type Matrix = Record<Role, Record<Permission, boolean>>;

const T = true;
const F = false;

export const PERMISSION_MATRIX: Matrix = {
  head_admin: {
    "projects.view": T,
    "projects.viewAll": T,
    "projects.create": T,
    "pricing.view": T,
    "pricing.edit": T,
    "specs.view": T,
    "specs.edit": T,
    "tasks.updateOwn": T,
    "tasks.assign": T,
    "approvals.manage": T,
    "users.changeRole": T,
    "permissions.edit": T,
    "audit.view": T,
    "pdf.generate": T,
    "chat.access": T,
  },
  admin: {
    "projects.view": T,
    "projects.viewAll": T,
    "projects.create": T,
    "pricing.view": T,
    "pricing.edit": T,
    "specs.view": T,
    "specs.edit": T,
    "tasks.updateOwn": T,
    "tasks.assign": T,
    "approvals.manage": T,
    "users.changeRole": F,
    "permissions.edit": F,
    "audit.view": T,
    "pdf.generate": T,
    "chat.access": T,
  },
  manager: {
    "projects.view": T,
    "projects.viewAll": F,
    "projects.create": T,
    "pricing.view": T,
    "pricing.edit": T,
    "specs.view": T,
    "specs.edit": T,
    "tasks.updateOwn": T,
    "tasks.assign": T,
    "approvals.manage": F,
    "users.changeRole": F,
    "permissions.edit": F,
    "audit.view": F,
    "pdf.generate": T,
    "chat.access": T,
  },
  product_supervisor: {
    "projects.view": T,
    "projects.viewAll": F,
    "projects.create": F,
    "pricing.view": F,
    "pricing.edit": F,
    "specs.view": T,
    "specs.edit": T,
    "tasks.updateOwn": T,
    "tasks.assign": F,
    "approvals.manage": F,
    "users.changeRole": F,
    "permissions.edit": F,
    "audit.view": F,
    "pdf.generate": T,
    "chat.access": T,
  },
  maker: {
    "projects.view": T,
    "projects.viewAll": F,
    "projects.create": F,
    "pricing.view": F,
    "pricing.edit": F,
    "specs.view": T,
    "specs.edit": F,
    "tasks.updateOwn": T,
    "tasks.assign": F,
    "approvals.manage": F,
    "users.changeRole": F,
    "permissions.edit": F,
    "audit.view": F,
    "pdf.generate": T, // own tasks only — scope enforced at query time
    "chat.access": T, // scoped to assigned project threads
  },
};

export function can(role: Role | null | undefined, perm: Permission): boolean {
  if (!role) return false;
  return PERMISSION_MATRIX[role]?.[perm] ?? false;
}

/** True when the role only ever sees projects it is explicitly assigned to. */
export function isAssignmentScoped(role: Role): boolean {
  return !can(role, "projects.viewAll");
}

/**
 * Maker status transitions are a fixed ladder — no free-text, no delete,
 * no reassign (spec §4).
 */
export const MAKER_TASK_STATUSES = [
  "assigned",
  "in_progress",
  "completed",
] as const;
export type MakerTaskStatus = (typeof MAKER_TASK_STATUSES)[number];

export const PROJECT_STATUSES = [
  "draft",
  "quoted",
  "approved",
  "in_production",
  "quality_check",
  "completed",
  "on_hold",
  "cancelled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/**
 * Field-level redaction. When a role cannot view pricing we never render a
 * blank — we render a locked placeholder (spec §4 / §5.2).
 */
export const RESTRICTED_PLACEHOLDER = "🔒 Restricted";

export function redactPricing<T extends Record<string, unknown>>(
  row: T,
  role: Role,
  priceKeys: (keyof T)[] = ["unit_price", "total_price", "material_cost", "labour_cost", "margin"],
): T {
  if (can(role, "pricing.view")) return row;
  const clone = { ...row };
  for (const k of priceKeys) {
    if (k in clone) (clone as Record<string, unknown>)[k as string] = null;
  }
  return clone;
}
