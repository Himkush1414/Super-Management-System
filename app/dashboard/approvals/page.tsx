import { UserCheck } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/shared/Page";
import { Card } from "@/components/ui/Card";
import { LiveRefresh } from "@/components/dashboard/LiveRefresh";
import { formatRelativeTime } from "@/lib/utils";
import type { Profile, SignupRequest } from "@/types/database.types";

export const metadata = { title: "Approvals" };

/**
 * View-only queue (spec §2): Admin can see name, contact and submitted time
 * for pending requests, but no longer decides them — that's Head Admin
 * exclusive, on the separate /dashboard/approvals/review route.
 */
export default async function ApprovalsPage() {
  await requirePermission("approvals.view");
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
        description="Access requests awaiting a decision. This queue is view-only."
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
              <p className="text-[14px] font-medium">{r.profiles?.full_name || "Unnamed"}</p>
              <p className="mt-1 text-[12px] text-text-secondary">
                {r.profiles?.contact_method === "phone" ? r.profiles?.phone : r.profiles?.email}{" "}
                · Submitted {formatRelativeTime(r.created_at)}
              </p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
