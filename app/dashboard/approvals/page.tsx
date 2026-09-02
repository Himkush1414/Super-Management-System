import { UserCheck } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/shared/Page";
import { Card } from "@/components/ui/Card";
import { RoleBadge } from "@/components/shared/Badge";
import { LiveRefresh } from "@/components/dashboard/LiveRefresh";
import { ApprovalActions } from "@/components/dashboard/ApprovalActions";
import { formatRelativeTime } from "@/lib/utils";
import type { Profile, SignupRequest } from "@/types/database.types";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  await requirePermission("approvals.manage");
  const supabase = await createClient();

  const { data } = await supabase
    .from("signup_requests")
    .select("*, profiles:profiles!signup_requests_profile_id_fkey(id, full_name, email, phone, contact_method)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as (SignupRequest & {
    profiles: Pick<Profile, "id" | "full_name" | "email" | "phone" | "contact_method"> | null;
  })[];

  return (
    <>
      <LiveRefresh channel="approvals-queue" table="signup_requests" />
      <PageHeader
        title="Pending approvals"
        description="Approve or reject access requests. Approving activates the account and notifies the user."
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<UserCheck size={24} />}
          title="Queue is clear"
          description="New access requests will appear here in real time."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[14px] font-medium">
                      {r.profiles?.full_name || "Unnamed"}
                    </p>
                    <span className="text-[12px] text-text-tertiary">requested</span>
                    <RoleBadge role={r.requested_role} />
                  </div>
                  <p className="mt-1 text-[12px] text-text-secondary">
                    {r.profiles?.contact_method === "phone"
                      ? r.profiles?.phone
                      : r.profiles?.email}{" "}
                    · {formatRelativeTime(r.created_at)}
                  </p>
                </div>
                <ApprovalActions requestId={r.id} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
