import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock, ShieldX, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AuthCard } from "@/components/shared/AuthCard";
import { Button } from "@/components/ui/Button";
import { ReapplyButton } from "./ReapplyButton";
import { signOutAction } from "@/lib/auth/actions";

export default async function PendingApprovalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <AuthCard
        title="Request submitted"
        subtitle="Your account request is with an administrator. You'll be notified by email once it's approved, after which you can sign in."
      >
        <Link href="/signin">
          <Button variant="secondary" className="w-full">
            Back to log in
          </Button>
        </Link>
      </AuthCard>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("status, full_name")
    .eq("id", user.id)
    .single();

  if (profile?.status === "active") redirect("/dashboard/overview");

  const rejected = profile?.status === "rejected";

  return (
    <AuthCard
      title={rejected ? "Request denied" : "Awaiting approval"}
      subtitle={
        rejected
          ? "An administrator declined your access request. You can contact an administrator directly, or submit a fresh request below."
          : "Your account is created but not yet active. An administrator (Head Admin or Admin) needs to approve it. This page will let you in as soon as that happens."
      }
    >
      <div className="flex flex-col items-center py-4 text-center">
        <span
          className={`inline-flex size-12 items-center justify-center rounded-full ${
            rejected
              ? "bg-status-danger/10 text-status-danger"
              : "bg-status-warning/10 text-status-warning"
          }`}
        >
          {rejected ? <ShieldX size={22} /> : <Clock size={22} />}
        </span>
        <p className="mt-4 text-[13px] text-text-secondary">
          Signed in as <span className="text-text">{user.email}</span>
        </p>
      </div>

      <div className="space-y-2">
        {rejected && <ReapplyButton />}
        <form action={signOutAction}>
          <Button type="submit" variant="ghost" className="w-full">
            <LogOut size={15} /> Sign out
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
