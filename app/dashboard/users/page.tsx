import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/Page";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Table, THead, TH, TR, TD } from "@/components/ui/Table";
import { UserStatusBadge } from "@/components/shared/Badge";
import { RoleEditor } from "@/components/dashboard/RoleEditor";
import { LiveRefresh } from "@/components/dashboard/LiveRefresh";
import {
  PERMISSION_MATRIX,
  ROLES,
  ROLE_LABEL,
  type Permission,
  type Role,
} from "@/lib/permissions";
import { formatDate } from "@/lib/utils";
import type { Profile } from "@/types/database.types";

export const metadata = { title: "Users" };

const PERMS: { key: Permission; label: string }[] = [
  { key: "projects.viewAll", label: "View all projects" },
  { key: "pricing.view", label: "View pricing" },
  { key: "pricing.edit", label: "Edit pricing" },
  { key: "specs.edit", label: "Edit specs" },
  { key: "projects.create", label: "Create project" },
  { key: "tasks.assign", label: "Assign makers" },
  { key: "approvals.manage", label: "Approve signups" },
  { key: "users.changeRole", label: "Change roles" },
  { key: "audit.view", label: "View audit log" },
];

export default async function UsersPage() {
  const ctx = await requirePermission("users.changeRole");
  const supabase = await createClient();

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });

  const users = (data ?? []) as Profile[];

  return (
    <>
      <LiveRefresh channel="users-list" table="profiles" />
      <PageHeader
        title="Users"
        description="Head Admin can change any user's role. Changes are written to the audit log."
      />

      <Card className="mb-6">
        <CardHeader title="Directory" />
        <CardBody className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Contact</TH>
                <TH>Role</TH>
                <TH>Status</TH>
                <TH>Joined</TH>
              </TR>
            </THead>
            <tbody>
              {users.map((u) => (
                <TR key={u.id}>
                  <TD className="font-medium">
                    {u.full_name || "—"}
                    {u.is_demo_account && (
                      <span className="ml-2 text-[11px] text-status-warning">demo</span>
                    )}
                  </TD>
                  <TD className="text-text-secondary">
                    {u.contact_method === "phone" ? u.phone : u.email}
                  </TD>
                  <TD>
                    <RoleEditor
                      userId={u.id}
                      current={u.role as Role}
                      disabled={u.id === ctx.userId}
                    />
                  </TD>
                  <TD>
                    <UserStatusBadge status={u.status} />
                  </TD>
                  <TD className="text-text-tertiary tnum">{formatDate(u.created_at)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Permission matrix"
          description="The single source of truth (lib/permissions.ts) — mirrored by database RLS policies."
        />
        <CardBody className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Capability</TH>
                {ROLES.map((r) => (
                  <TH key={r} className="text-center">
                    {ROLE_LABEL[r]}
                  </TH>
                ))}
              </TR>
            </THead>
            <tbody>
              {PERMS.map((p) => (
                <TR key={p.key}>
                  <TD className="text-text-secondary">{p.label}</TD>
                  {ROLES.map((r) => (
                    <TD key={r} className="text-center">
                      {PERMISSION_MATRIX[r][p.key] ? (
                        <span className="text-status-success">●</span>
                      ) : (
                        <span className="text-text-tertiary">—</span>
                      )}
                    </TD>
                  ))}
                </TR>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
      <p className="mt-3 text-[12px] text-text-tertiary">
        Editing the matrix itself changes database RLS policies and ships as a
        migration (<span className="tnum">supabase/migrations/</span>) so the UI
        and the database can never drift apart. It is intentionally not a
        runtime toggle.
      </p>
    </>
  );
}
