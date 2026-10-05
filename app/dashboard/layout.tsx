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
    requireSession(),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
  ]);

  return (
    <Shell
      role={ctx.role}
      name={ctx.name}
      userId={ctx.userId}
      initialUnread={count ?? 0}
    >
      {children}
    </Shell>
  );
}
