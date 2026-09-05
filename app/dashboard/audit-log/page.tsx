import { ScrollText } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/shared/Page";
import { Table, THead, TH, TR, TD } from "@/components/ui/Table";
import { Badge } from "@/components/shared/Badge";
import { LiveRefresh } from "@/components/dashboard/LiveRefresh";
import type { AuditEntry } from "@/types/database.types";

export const metadata = { title: "Audit log" };

function summarise(entry: AuditEntry): string {
  const b = (entry.before ?? {}) as Record<string, unknown>;
  const a = (entry.after ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const diffs: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) {
      diffs.push(`${k}: ${fmt(b[k])} → ${fmt(a[k])}`);
    }
  }
  return diffs.join("  ·  ") || "—";
}
const fmt = (v: unknown) =>
  v === null || v === undefined ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v);

const actionTone = (action: string) =>
  action.includes("reject") || action.includes("cancel")
    ? "danger"
    : action.includes("approv")
      ? "success"
      : action.startsWith("price") || action.startsWith("role")
        ? "warning"
        : "neutral";

export default async function AuditLogPage() {
  await requirePermission("audit.view");
  const supabase = await createClient();

  const { data } = await supabase
    .from("audit_log_view")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  const entries = (data ?? []) as AuditEntry[];

  return (
    <>
      <LiveRefresh channel="audit-feed" table="audit_log" />
      <PageHeader
        title="Audit log"
        description="Role changes, approvals, price edits and status changes — actor, time, and before/after."
      />

      {entries.length === 0 ? (
        <EmptyState
          icon={<ScrollText size={24} />}
          title="No entries yet"
          description="Sensitive changes are recorded here as they happen."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Actor</TH>
              <TH>Action</TH>
              <TH>Entity</TH>
              <TH>Change</TH>
            </TR>
          </THead>
          <tbody>
            {entries.map((e) => (
              <TR key={e.id}>
                <TD className="whitespace-nowrap text-text-tertiary tnum">
                  {new Date(e.created_at).toLocaleString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </TD>
                <TD className="whitespace-nowrap text-text-secondary">
                  {e.actor_label ?? "system"}
                </TD>
                <TD>
                  <Badge tone={actionTone(e.action)}>{e.action}</Badge>
                </TD>
                <TD className="text-text-tertiary">{e.entity_type}</TD>
                <TD className="text-[12px] text-text-secondary">{summarise(e)}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
