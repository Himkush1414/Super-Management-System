import { requireRole } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/Page";
import { Card, CardBody } from "@/components/ui/Card";
import { DispatchForm } from "@/components/dashboard/DispatchForm";

export const metadata = { title: "Dispatch order" };

export default async function NewOrderPage() {
  await requireRole("marketing");

  // Privileged read: the production roster + whether each has a confirmed phone.
  // Done with the service role so raw phone numbers never reach the marketing
  // client — only a boolean.
  const svc = createServiceClient();
  const [{ data: profiles }, { data: settings }] = await Promise.all([
    svc.from("profiles").select("id, full_name").eq("role", "production").order("full_name"),
    svc.from("production_settings").select("profile_id, phone, confirmed_at"),
  ]);

  const ready = new Set(
    (settings ?? [])
      .filter((s) => s.phone && s.confirmed_at)
      .map((s) => s.profile_id as string),
  );

  const production = (profiles ?? []).map((p) => ({
    id: p.id as string,
    full_name: p.full_name as string,
    hasPhone: ready.has(p.id as string),
  }));

  return (
    <>
      <PageHeader
        title="Dispatch order"
        description="Create a production order and send it to a production team."
      />
      <Card className="max-w-2xl">
        <CardBody>
          <DispatchForm production={production} />
        </CardBody>
      </Card>
    </>
  );
}
