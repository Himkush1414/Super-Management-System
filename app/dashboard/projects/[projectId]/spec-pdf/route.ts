import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { renderSpecSheet } from "@/lib/pdf-generator";
import type { Profile, Project, Task } from "@/types/database.types";

// @react-pdf/renderer needs the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const ctx = await requireSession();

  if (!ctx.can("pdf.generate")) {
    return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  }

  const supabase = await createClient();

  const { data: projectData } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();
  const project = projectData as Project | null;

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Makers: only tasks assigned to them go in the sheet (spec §5.2).
  let taskQuery = supabase
    .from("tasks")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (ctx.role === "maker") taskQuery = taskQuery.eq("assigned_to", ctx.userId);
  const { data: tasks } = await taskQuery;

  let managerName: string | null = null;
  if (project.assigned_manager) {
    const { data: mgr } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", project.assigned_manager)
      .maybeSingle();
    managerName = (mgr as Pick<Profile, "full_name"> | null)?.full_name ?? null;
  }

  // Pricing inclusion is derived from the requesting user's role — never a toggle.
  const buffer = await renderSpecSheet({
    project,
    tasks: (tasks ?? []) as Task[],
    managerName,
    requestedBy: { full_name: ctx.profile.full_name, role: ctx.role },
  });

  const slug = project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="nr-${slug}-spec.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
