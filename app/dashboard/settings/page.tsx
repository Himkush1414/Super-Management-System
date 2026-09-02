import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shared/Page";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { RoleBadge } from "@/components/shared/Badge";
import { ROLE_DESCRIPTION } from "@/lib/permissions";
import { ProfileForm } from "@/components/dashboard/ProfileForm";
import { SignOutEverywhere } from "@/components/dashboard/SignOutEverywhere";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireSession();
  const isAdminTier = ["head_admin", "admin"].includes(ctx.role);

  return (
    <>
      <PageHeader title="Settings" description="Your account and profile." />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Profile" />
            <CardBody>
              <ProfileForm
                fullName={ctx.profile.full_name}
                phone={ctx.profile.phone ?? ""}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Security"
              description="Email accounts use a one-time code as a second factor on every login."
            />
            <CardBody className="space-y-3 text-[13px]">
              <Row k="Sign-in method" v={ctx.profile.contact_method === "phone" ? "Phone + password" : "Email + password + OTP"} />
              <Row
                k="SMS one-time codes"
                v={<span className="text-text-tertiary">Coming soon</span>}
              />
              {isAdminTier && (
                <div className="border-t border-border pt-3">
                  <SignOutEverywhere />
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title="Access" />
          <CardBody className="space-y-3 text-[13px]">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-text-tertiary">Role</p>
              <div className="mt-1">
                <RoleBadge role={ctx.role} />
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-text-secondary">
                {ROLE_DESCRIPTION[ctx.role]}
              </p>
            </div>
            <Row k="Email" v={ctx.email ?? "—"} />
            <Row k="Member since" v={formatDate(ctx.profile.created_at)} />
            <p className="border-t border-border pt-3 text-[12px] text-text-tertiary">
              Only the Head Admin can change roles. Contact them if your access
              needs to change.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-text-secondary">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}
