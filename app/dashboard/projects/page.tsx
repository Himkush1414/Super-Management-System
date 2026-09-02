import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/shared/Page";
import { Table, THead, TH, TR, TD } from "@/components/ui/Table";
import { ProjectStatusBadge } from "@/components/shared/Badge";
import { NewProjectDialog } from "@/components/dashboard/NewProjectDialog";
import { LiveRefresh } from "@/components/dashboard/LiveRefresh";
import { RESTRICTED_PLACEHOLDER } from "@/lib/permissions";
import { TRANSFORMER_LABEL } from "@/lib/constants";
import { formatCurrency, formatNumber } from "@/lib/utils";
import type { Project } from "@/types/database.types";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const ctx = await requireSession();
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("*")
    .order("updated_at", { ascending: false });

  const projects = (data ?? []) as Project[];
  const showPricing = ctx.can("pricing.view");

  return (
    <>
      <LiveRefresh channel="projects-list" table="projects" />
      <PageHeader
        title="Projects"
        description={
          ctx.can("projects.viewAll")
            ? "Every project and order."
            : "Projects you're assigned to."
        }
        action={
          ctx.can("projects.create") ? (
            <NewProjectDialog canSeePricing={showPricing} />
          ) : null
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban size={24} />}
          title="No projects in your scope"
          description={
            ctx.can("projects.create")
              ? "Create the first project to get started."
              : "You'll see projects here once you're assigned to one."
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Project</TH>
              <TH>Client</TH>
              <TH>Type</TH>
              <TH numeric>kVA</TH>
              <TH numeric>Qty</TH>
              {showPricing && <TH numeric>Order value</TH>}
              <TH>Status</TH>
            </TR>
          </THead>
          <tbody>
            {projects.map((p) => (
              <TR key={p.id}>
                <TD>
                  <Link
                    href={`/dashboard/projects/${p.id}`}
                    className="font-medium text-text hover:text-accent"
                  >
                    {p.name}
                  </Link>
                </TD>
                <TD className="text-text-secondary">{p.client_name || "—"}</TD>
                <TD className="text-text-secondary">
                  {TRANSFORMER_LABEL[p.transformer_kind]}
                </TD>
                <TD numeric>{formatNumber(p.capacity_kva)}</TD>
                <TD numeric>{p.quantity}</TD>
                {showPricing && (
                  <TD numeric>{formatCurrency(p.total_price)}</TD>
                )}
                <TD>
                  {!showPricing && p.unit_price === null ? null : null}
                  <ProjectStatusBadge status={p.status} />
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}

      {!showPricing && projects.length > 0 && (
        <p className="mt-3 text-[12px] text-text-tertiary">
          Order value is <span className="text-text-secondary">{RESTRICTED_PLACEHOLDER}</span>{" "}
          for your role.
        </p>
      )}
    </>
  );
}
