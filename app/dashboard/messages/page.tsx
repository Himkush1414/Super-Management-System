import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { listContacts } from "@/lib/actions/messages";
import { PageHeader } from "@/components/shared/Page";
import { MessagesShell } from "@/components/messages/MessagesShell";

export const metadata = { title: "Messages" };

export default async function MessagesPage() {
  const ctx = await requireSession();
  // Head Admin has no Messages tab and never appears in anyone's contact
  // list (spec §1/§4) — the nav already hides this route for that role, this
  // is the defensive server-side backstop.
  if (ctx.role === "head_admin") redirect("/dashboard/overview");

  const contacts = await listContacts();

  return (
    <div className="flex h-[calc(100vh-8.5rem)] flex-col">
      <PageHeader
        title="Messages"
        description="Direct messages auto-delete 60 hours after the last message in a thread."
      />
      <MessagesShell currentUserId={ctx.userId} contacts={contacts} />
    </div>
  );
}
