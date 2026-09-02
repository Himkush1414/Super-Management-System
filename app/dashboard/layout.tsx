import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/dashboard/Shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireSession();
  const supabase = await createClient();

  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  return (
    <Shell
      role={ctx.role}
      name={ctx.profile.full_name || ctx.email || "User"}
      userId={ctx.userId}
      initialUnread={count ?? 0}
    >
      {children}
    </Shell>
  );
}
