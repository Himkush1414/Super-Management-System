import Link from "next/link";
import { notFound } from "next/navigation";
import { MessagesSquare, FileDown, Lock } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { ProjectStatusBadge, RoleBadge } from "@/components/shared/Badge";
import { LiveRefresh } from "@/components/dashboard/LiveRefresh";
import { ProjectStatusControl } from "@/components/dashboard/ProjectStatusControl";
import { SpecsForm } from "@/components/dashboard/SpecsForm";
import { PricingForm } from "@/components/dashboard/PricingForm";
import { AssignmentsPanel } from "@/components/dashboard/AssignmentsPanel";
import { TasksPanel } from "@/components/dashboard/TasksPanel";
import { Button } from "@/components/ui/Button";
import { RESTRICTED_PLACEHOLDER } from "@/lib/permissions";
import { TRANSFORMER_LABEL } from "@/lib/constants";
import { formatNumber } from "@/lib/utils";
import type { Profile, Project, ProjectAssignment, Task } from "@/types/database.types";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const ctx = await requireSession();
  const supabase = await createClient();

  const { data: projectData } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();
  const project = projectData as Project | null;

  if (!project) notFound();

  const [{ data: assignments }, { data: tasks }, { data: manager }, { data: staff }] =
    await Promise.all([
      supabase
        .from("project_assignments")
        .select("*, profiles:profiles!project_assignments_user_id_fkey(id, full_name, role)")
        .eq("project_id", projectId),
      supabase
        .from("tasks")
        .select("*, profiles:profiles!tasks_assigned_to_fkey(id, full_name, role)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true }),
      project.assigned_manager
        ? supabase
            .from("profiles")
            .select("id, full_name, role")
            .eq("id", project.assigned_manager)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      ctx.can("tasks.assign")
        ? supabase
            .from("profiles")
            .select("id, full_name, role")
            .eq("status", "active")
            .in("role", ["maker", "product_supervisor"])
        : Promise.resolve({ data: [] }),
    ]);

  const assignRows = (assignments ?? []) as (ProjectAssignment & {
    profiles: Pick<Profile, "id" | "full_name" | "role"> | null;
  })[];
  const taskRows = (tasks ?? []) as (Task & {
    profiles: Pick<Profile, "id" | "full_name" | "role"> | null;
  })[];

  const showPricing = ctx.can("pricing.view");
  const canEditSpecs =
    ctx.can("specs.edit") &&
    (ctx.can("projects.viewAll") ||
      project.assigned_manager === ctx.userId ||
      assignRows.some((a) => a.user_id === ctx.userId));
  const canEditPricing =
    ctx.can("pricing.edit") &&
    (ctx.can("projects.viewAll") || project.assigned_manager === ctx.userId);
  const canChangeStatus = canEditSpecs || canEditPricing;

  return (
    <>
      <LiveRefresh channel={`proj-${projectId}`} table="projects" filter={`id=eq.${projectId}`} />
      <LiveRefresh channel={`proj-tasks-${projectId}`} table="tasks" filter={`project_id=eq.${projectId}`} />

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
            <ProjectStatusBadge status={project.status} />
          </div>
          <p className="mt-1 text-[13px] text-text-secondary">
            {project.client_name || "No client"}
            {project.client_contact ? ` · ${project.client_contact}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href={`/dashboard/projects/${projectId}/chat`}>
            <Button variant="secondary" size="sm">
              <MessagesSquare size={14} /> Chat
            </Button>
          </Link>
          <a href={`/dashboard/projects/${projectId}/spec-pdf`} target="_blank" rel="noreferrer">
            <Button variant="secondary" size="sm">
              <FileDown size={14} /> Spec PDF
            </Button>
          </a>
        </div>
      </div>

      {canChangeStatus && (
        <div className="mb-6">
          <ProjectStatusControl projectId={projectId} current={project.status} />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Transformer specification" />
            <CardBody>
              {canEditSpecs ? (
                <SpecsForm project={project} />
              ) : (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-3">
                  <Spec k="Type" v={TRANSFORMER_LABEL[project.transformer_kind]} />
                  <Spec k="Capacity" v={formatNumber(project.capacity_kva, " kVA")} />
                  <Spec k="Quantity" v={String(project.quantity)} />
                  <Spec k="Primary" v={project.primary_voltage ?? "—"} />
                  <Spec k="Secondary" v={project.secondary_voltage ?? "—"} />
                  <Spec k="Phase" v={project.phase ? `${project.phase}-phase` : "—"} />
                  <Spec k="Frequency" v={formatNumber(project.frequency_hz, " Hz")} />
                  <Spec k="Cooling" v={project.cooling_type ?? "—"} />
                  <Spec k="Impedance" v={formatNumber(project.impedance_pct, " %")} />
                </dl>
              )}
              {!canEditSpecs && (
                <div className="mt-4 border-t border-border pt-4">
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-text-tertiary">
                    Requirements
                  </p>
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-secondary">
                    {project.requirements_notes || "—"}
                  </p>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Pricing & cost"
              description={
                showPricing
                  ? "Restricted — not visible to Product Supervisor or Maker."
                  : undefined
              }
            />
            <CardBody>
              {!showPricing ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-subtle px-4 py-6 text-[13px] text-text-secondary">
                  <Lock size={15} className="text-text-tertiary" />
                  {RESTRICTED_PLACEHOLDER} — pricing is not available for your role.
                </div>
              ) : canEditPricing ? (
                <PricingForm project={project} />
              ) : (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-4">
                  <Spec k="Unit price" v={money(project.unit_price)} numeric />
                  <Spec k="Material" v={money(project.material_cost)} numeric />
                  <Spec k="Labour" v={money(project.labour_cost)} numeric />
                  <Spec k="Margin" v={money(project.margin)} numeric />
                  <Spec k="Order total" v={money(project.total_price)} numeric />
                </dl>
              )}
            </CardBody>
          </Card>

          <TasksPanel
            projectId={projectId}
            tasks={taskRows}
            canAssign={ctx.can("tasks.assign")}
            currentUserId={ctx.userId}
            makers={((staff ?? []) as Pick<Profile, "id" | "full_name" | "role">[]).filter(
              (s) => s.role === "maker",
            )}
          />
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Team" />
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-text-secondary">Manager</span>
                <span className="flex items-center gap-2">
                  {manager ? (
                    <>
                      {(manager as Profile).full_name}
                      <RoleBadge role="manager" />
                    </>
                  ) : (
                    <span className="text-text-tertiary">Unassigned</span>
                  )}
                </span>
              </div>
              <AssignmentsPanel
                projectId={projectId}
                assignments={assignRows}
                canManage={ctx.can("tasks.assign")}
                staff={(staff ?? []) as Pick<Profile, "id" | "full_name" | "role">[]}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function Spec({
  k,
  v,
  numeric,
}: {
  k: string;
  v: string;
  numeric?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-text-tertiary">{k}</dt>
      <dd className={numeric ? "tnum text-text" : "text-text"}>{v}</dd>
    </div>
  );
}

function money(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}
