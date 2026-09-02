import Link from "next/link";
import {
  FolderKanban,
  ListTodo,
  UserCheck,
  CircleCheck,
  ArrowRight,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/shared/Page";
import { StatCard, Card, CardHeader } from "@/components/ui/Card";
import { ProjectStatusBadge, TaskStatusBadge } from "@/components/shared/Badge";
import { LiveRefresh } from "@/components/dashboard/LiveRefresh";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";
import type { Project, Task } from "@/types/database.types";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const ctx = await requireSession();
  const supabase = await createClient();

  const [{ data: projects }, { data: tasks }, approvals] = await Promise.all([
    supabase
      .from("projects")
      .select("*")
      .order("updated_at", { ascending: false }),
    supabase
      .from("tasks")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(50),
    ctx.can("approvals.manage")
      ? supabase
          .from("signup_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending")
      : Promise.resolve({ count: 0 }),
  ]);

  const proj = (projects ?? []) as Project[];
  const tk = (tasks ?? []) as Task[];
  const openTasks = tk.filter((t) => t.status !== "completed");
  const inProduction = proj.filter((p) => p.status === "in_production").length;
  const pipelineValue = ctx.can("pricing.view")
    ? proj.reduce((s, p) => s + (p.total_price ?? 0), 0)
    : null;

  return (
    <>
      <LiveRefresh channel="ov-projects" table="projects" />
      <LiveRefresh channel="ov-tasks" table="tasks" />
      <PageHeader
        title={`Welcome, ${ctx.profile.full_name.split(" ")[0] || "there"}`}
        description="Your production picture at a glance."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Projects in scope"
          value={proj.length}
          sub={`${inProduction} in production`}
          icon={<FolderKanban size={15} />}
        />
        <StatCard
          label="Open tasks"
          value={openTasks.length}
          sub={`${tk.length - openTasks.length} completed`}
          icon={<ListTodo size={15} />}
        />
        {ctx.can("approvals.manage") && (
          <StatCard
            label="Pending approvals"
            value={approvals.count ?? 0}
            sub="awaiting review"
            icon={<UserCheck size={15} />}
          />
        )}
        {pipelineValue !== null ? (
          <StatCard
            label="Pipeline value"
            value={formatCurrency(pipelineValue)}
            sub="sum of order totals"
            icon={<CircleCheck size={15} />}
          />
        ) : (
          <StatCard
            label="Completed"
            value={proj.filter((p) => p.status === "completed").length}
            sub="delivered projects"
            icon={<CircleCheck size={15} />}
          />
        )}
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Recent projects"
            action={
              <Link
                href="/dashboard/projects"
                className="inline-flex items-center gap-1 text-[12px] text-text-secondary hover:text-text"
              >
                All <ArrowRight size={12} />
              </Link>
            }
          />
          {proj.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No projects yet"
                description="Projects you're assigned to will appear here."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {proj.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/dashboard/projects/${p.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-white/[0.02]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{p.name}</p>
                      <p className="truncate text-[12px] text-text-tertiary">
                        {p.client_name || "—"}
                      </p>
                    </div>
                    <ProjectStatusBadge status={p.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={ctx.role === "maker" ? "My tasks" : "Recent task activity"} />
          {tk.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No tasks"
                description={
                  ctx.role === "maker"
                    ? "Tasks assigned to you will show up here."
                    : "Task updates across your projects will show here."
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {tk.slice(0, 6).map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{t.title}</p>
                    <p className="text-[12px] text-text-tertiary">
                      {formatRelativeTime(t.updated_at)}
                    </p>
                  </div>
                  <TaskStatusBadge status={t.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
