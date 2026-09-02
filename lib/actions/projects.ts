"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { PROJECT_STATUSES, type ProjectStatus } from "@/lib/permissions";

export type Result = { error?: string; ok?: string; id?: string };

function num(v: FormDataEntryValue | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function createProject(
  _prev: Result | null,
  formData: FormData,
): Promise<Result> {
  const ctx = await requireSession();
  if (!ctx.can("projects.create"))
    return { error: "You can't create projects." };

  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Project name is required." };

  const payload = {
    name,
    client_name: String(formData.get("client_name") ?? "").trim(),
    client_contact: String(formData.get("client_contact") ?? "").trim() || null,
    transformer_kind: String(formData.get("transformer_kind") ?? "distribution"),
    capacity_kva: num(formData.get("capacity_kva")),
    primary_voltage: String(formData.get("primary_voltage") ?? "").trim() || null,
    secondary_voltage:
      String(formData.get("secondary_voltage") ?? "").trim() || null,
    phase: num(formData.get("phase")),
    frequency_hz: num(formData.get("frequency_hz")) ?? 50,
    cooling_type: String(formData.get("cooling_type") ?? "").trim() || null,
    impedance_pct: num(formData.get("impedance_pct")),
    requirements_notes: String(formData.get("requirements_notes") ?? "").trim(),
    quantity: num(formData.get("quantity")) ?? 1,
    unit_price: ctx.can("pricing.edit") ? num(formData.get("unit_price")) : null,
    material_cost: ctx.can("pricing.edit")
      ? num(formData.get("material_cost"))
      : null,
    labour_cost: ctx.can("pricing.edit")
      ? num(formData.get("labour_cost"))
      : null,
    margin: ctx.can("pricing.edit") ? num(formData.get("margin")) : null,
    assigned_manager:
      String(formData.get("assigned_manager") ?? "").trim() ||
      (ctx.role === "manager" ? ctx.userId : null),
    created_by: ctx.userId,
  };

  const { data, error } = await supabase
    .from("projects")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/dashboard/projects");
  redirect(`/dashboard/projects/${(data as { id: string }).id}`);
}

export async function updateProjectStatus(
  projectId: string,
  status: ProjectStatus,
): Promise<Result> {
  if (!PROJECT_STATUSES.includes(status)) return { error: "Invalid status." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ status })
    .eq("id", projectId);
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/dashboard/projects");
  return { ok: "Status updated." };
}

export async function updateProjectFields(
  _prev: Result | null,
  formData: FormData,
): Promise<Result> {
  const ctx = await requireSession();
  const projectId = String(formData.get("project_id") ?? "");
  if (!projectId) return { error: "Missing project." };

  const supabase = await createClient();
  const patch: Record<string, unknown> = {};

  if (ctx.can("specs.edit")) {
    patch.requirements_notes = String(
      formData.get("requirements_notes") ?? "",
    ).trim();
    patch.primary_voltage =
      String(formData.get("primary_voltage") ?? "").trim() || null;
    patch.secondary_voltage =
      String(formData.get("secondary_voltage") ?? "").trim() || null;
    patch.capacity_kva = num(formData.get("capacity_kva"));
    patch.cooling_type =
      String(formData.get("cooling_type") ?? "").trim() || null;
    patch.impedance_pct = num(formData.get("impedance_pct"));
  }

  if (ctx.can("pricing.edit")) {
    patch.unit_price = num(formData.get("unit_price"));
    patch.material_cost = num(formData.get("material_cost"));
    patch.labour_cost = num(formData.get("labour_cost"));
    patch.margin = num(formData.get("margin"));
    patch.quantity = num(formData.get("quantity")) ?? 1;
  }

  if (Object.keys(patch).length === 0)
    return { error: "Nothing you're allowed to edit here." };

  const { error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", projectId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: "Saved." };
}

export async function assignMaker(
  projectId: string,
  makerId: string,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_assignments")
    .insert({
      project_id: projectId,
      user_id: makerId,
      role_at_assignment: "maker",
    });
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: "Maker assigned." };
}

export async function unassignUser(
  projectId: string,
  userId: string,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_assignments")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: "Removed." };
}

export async function createTask(
  _prev: Result | null,
  formData: FormData,
): Promise<Result> {
  const ctx = await requireSession();
  if (!ctx.can("tasks.assign")) return { error: "Not allowed." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .insert({
      project_id: String(formData.get("project_id")),
      title: String(formData.get("title") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim(),
      assigned_to: String(formData.get("assigned_to") ?? "") || null,
      due_date: String(formData.get("due_date") ?? "") || null,
      created_by: ctx.userId,
    });
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/projects/${formData.get("project_id")}`);
  return { ok: "Task created." };
}

export async function updateTaskStatus(
  taskId: string,
  status: "assigned" | "in_progress" | "completed",
  projectId: string,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ status })
    .eq("id", taskId);
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/dashboard/overview");
  return { ok: "Task updated." };
}
