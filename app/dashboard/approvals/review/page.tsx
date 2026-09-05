import { UserCheck } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/shared/Page";
import { Card } from "@/components/ui/Card";
import { LiveRefresh } from "@/components/dashboard/LiveRefresh";
import { HeadAdminReview } from "@/components/dashboard/HeadAdminReview";
import { formatRelativeTime } from "@/lib/utils";
import type { Profile, SignupRequest } from "@/types/database.types";

export const metadata = { title: "Review requests" };

/**
 * Head-Admin-exclusive: undiscoverable route (no nav link is ever rendered
 * for anyone else, and the middleware route guard requires approvals.decide,
 * which only head_admin has). Full request detail + approve-with-role /
 * reject in one action (spec §2/§3).
 */
export default async function ApprovalsReviewPage() {
  await requirePermission("approvals.decide");
  const supabase = await createClient();

  const { data } = await supabase
    .from("signup_requests")
    .select("*, profiles:profiles!signup_requests_profile_id_fkey(id, full_name, email, phone, contact_method, created_at)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as (SignupRequest & {
    profiles: Pick<Profile, "id" | "full_name" | "email" | "phone" | "contact_method" | "created_at"> | null;
  })[];

  return (
    <>
      <LiveRefresh channel="approvals-review-queue" table="signup_requests" />
      <PageHeader
        title="Review requests"
        description="Approve with a role, or reject. Approving activates the account and notifies the user."
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
                  <p className="text-[14px] font-medium">{r.profiles?.full_name || "Unnamed"}</p>
                  <p className="mt-1 text-[12px] text-text-secondary">
                    {r.profiles?.contact_method === "phone" ? r.profiles?.phone : r.profiles?.email}{" "}
                    · Submitted {formatRelativeTime(r.created_at)}
                  </p>
                </div>
                <HeadAdminReview requestId={r.id} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
