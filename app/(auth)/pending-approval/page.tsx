import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthCard } from "@/components/shared/AuthCard";
import { Button } from "@/components/ui/Button";

/**
 * Only reached pre-session (e.g. an email OTP link opened in a fresh
 * browser with no cookies yet). Once signed in, pending/rejected accounts
 * stay on /dashboard/* and see the PendingGate there instead — this page no
 * longer duplicates that state.
 */
export default async function PendingApprovalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/dashboard/overview");

  return (
    <AuthCard
      title="Request submitted"
      subtitle="Your request has been sent. Please wait for approval."
    >
      <Link href="/signin">
        <Button variant="secondary" className="w-full">
          Back to log in
        </Button>
      </Link>
    </AuthCard>
  );
}
