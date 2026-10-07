import { requireRole } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/Page";
import { Card, CardBody } from "@/components/ui/Card";
import { PunchOrderForm } from "@/components/dashboard/PunchOrderForm";
import { displayName } from "@/lib/names";
import type { Profile } from "@/types/database.types";

export const metadata = { title: "Punch Order" };

/** Today's date in IST as YYYY-MM-DD (the business runs on Indian time). */
function todayInIndia() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

export default async function NewOrderPage() {
  await requireRole("marketing");

  // Privileged read: the production roster + whether each has a confirmed phone.
  // Done with the service role so raw phone numbers never reach the marketing
  // client — only a boolean.
  const svc = createServiceClient();
  const [{ data: profiles }, { data: settings }] = await Promise.all([
    svc.from("profiles").select("id, full_name, real_name, role").eq("role", "production").order("full_name"),
    svc.from("production_settings").select("profile_id, phone, confirmed_at"),
  ]);

  const ready = new Set(
    (settings ?? [])
      .filter((s) => s.phone && s.confirmed_at)
      .map((s) => s.profile_id as string),
  );

  const production = (profiles ?? []).map((p) => ({
    id: p.id as string,
    label: displayName(p as Profile),
    // ready = real name + confirmed phone; otherwise the order waits (0016)
    ready: ready.has(p.id as string) && Boolean(p.real_name),
  }));

  return (
    <>
      <PageHeader
        title="Punch Order"
        description="Create a production order and send it to a production team."
      />
      <Card className="max-w-3xl">
        <CardBody>
          <PunchOrderForm production={production} today={todayInIndia()} />
        </CardBody>
      </Card>
    </>
  );
}
