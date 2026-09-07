import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/Page";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { PhoneForm } from "@/components/dashboard/PhoneForm";
import type { ProductionSettings } from "@/types/database.types";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireRole("production");
  const supabase = await createClient();

  const { data } = await supabase
    .from("production_settings")
    .select("*")
    .eq("profile_id", ctx.userId)
    .maybeSingle<ProductionSettings>();

  return (
    <>
      <PageHeader
        title="Settings"
        description="Register the phone number for your WhatsApp order groups."
      />
      <Card className="max-w-lg">
        <CardHeader
          title="Phone number"
          description="Required before an order assigned to you can start."
        />
        <CardBody>
          <PhoneForm
            phone={data?.phone ?? null}
            confirmedAt={data?.confirmed_at ?? null}
          />
        </CardBody>
      </Card>
    </>
  );
}
