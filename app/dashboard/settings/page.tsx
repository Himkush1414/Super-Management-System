import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/Page";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { SettingsForm } from "@/components/dashboard/SettingsForm";
import type { ProductionSettings } from "@/types/database.types";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  // The one page an account mid-setup may open.
  const ctx = await requireSession({ allowIncompleteSetup: true });
  if (ctx.role !== "marketing" && ctx.role !== "production") redirect("/dashboard/orders");
  const isProduction = ctx.role === "production";

  const { data } = isProduction
    ? await (await createClient())
        .from("production_settings")
        .select("*")
        .eq("profile_id", ctx.userId)
        .maybeSingle<ProductionSettings>()
    : { data: null };

  const settingUp = ctx.missingSetup.length > 0;

  return (
    <>
      <PageHeader
        title={settingUp ? "Finish setting up your account" : "Settings"}
        description={
          settingUp
            ? isProduction
              ? "Add your real name and WhatsApp number to start working on orders."
              : "Add your real name to start punching orders."
            : "Your details as they appear to the rest of the team."
        }
      />
      <Card className="max-w-lg">
        <CardHeader
          title={isProduction ? "Name and phone" : "Your name"}
          description={settingUp ? "Required before you can continue." : undefined}
        />
        <CardBody>
          <SettingsForm
            role={ctx.role as "marketing" | "production"}
            accountLabel={ctx.profile.full_name}
            realName={ctx.profile.real_name}
            phone={data?.phone ?? null}
            phoneConfirmed={Boolean(data?.phone && data?.confirmed_at)}
          />
        </CardBody>
      </Card>
      {!settingUp && (
        <p className="mt-4 text-[12px] text-text-tertiary">
          <Link href="/dashboard/orders" className="hover:text-text-secondary">
            ← Back to orders
          </Link>
        </p>
      )}
    </>
  );
}
