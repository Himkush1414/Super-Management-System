import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/dashboard/Shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  // In parallel: the unread count is RLS-scoped to the caller already.
  const [ctx, { count }] = await Promise.all([
    // The shell renders even mid-setup; each page enforces the setup gate.
    requireSession({ allowIncompleteSetup: true }),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
  ]);

  return (
    <Shell
      role={ctx.role}
      name={ctx.profile.real_name ?? ctx.name}
      caption={ctx.profile.real_name ? ctx.profile.full_name : undefined}
      userId={ctx.userId}
      initialUnread={count ?? 0}
    >
      {children}
    </Shell>
  );
}
