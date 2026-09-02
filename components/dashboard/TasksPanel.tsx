"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import {
  createTask,
  updateTaskStatus,
  type Result,
} from "@/lib/actions/projects";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Input, Textarea, Select, Label, FormRow } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { TaskStatusBadge } from "@/components/shared/Badge";
import { FormAlert } from "@/components/shared/AuthCard";
import { EmptyState } from "@/components/shared/Page";
import { MAKER_TASK_STATUSES } from "@/lib/permissions";
import { formatDate } from "@/lib/utils";
import type { Profile, Task } from "@/types/database.types";

type Row = Task & {
  profiles: Pick<Profile, "id" | "full_name" | "role"> | null;
};

function TaskStatusSelect({
  task,
  projectId,
}: {
  task: Task;
  projectId: string;
}) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(task.status);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <Select
        className="h-8 w-36 text-[12px]"
        value={status}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as (typeof MAKER_TASK_STATUSES)[number];
          setStatus(next);
          start(async () => {
            const r = await updateTaskStatus(task.id, next, projectId);
            if (r.error) {
              setErr(r.error);
              setStatus(task.status);
            } else setErr(null);
          });
        }}
      >
        {MAKER_TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, " ")}
          </option>
        ))}
      </Select>
      {err && <span className="text-[11px] text-status-danger">{err}</span>}
    </div>
  );
}

export function TasksPanel({
  projectId,
  tasks,
  canAssign,
  currentUserId,
  makers,
}: {
  projectId: string;
  tasks: Row[];
  canAssign: boolean;
  currentUserId: string;
  makers: Pick<Profile, "id" | "full_name" | "role">[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<Result | null, FormData>(
    createTask,
    null,
  );

  return (
    <Card>
      <CardHeader
        title="Tasks"
        action={
          canAssign ? (
            <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
              <Plus size={14} /> Task
            </Button>
          ) : null
        }
      />

      {open && canAssign && (
        <div className="border-b border-border bg-bg-subtle px-5 py-4">
          <form
            action={(fd) => {
              action(fd);
              setOpen(false);
            }}
            className="space-y-3"
          >
            <FormAlert state={state} />
            <input type="hidden" name="project_id" value={projectId} />
            <div className="grid gap-3 sm:grid-cols-2">
              <FormRow>
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" required />
              </FormRow>
              <FormRow>
                <Label htmlFor="assigned_to">Assign to</Label>
                <Select id="assigned_to" name="assigned_to">
                  <option value="">Unassigned</option>
                  {makers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name}
                    </option>
                  ))}
                </Select>
              </FormRow>
            </div>
            <FormRow>
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" name="description" rows={2} />
            </FormRow>
            <FormRow>
              <Label htmlFor="due_date">Due date</Label>
              <Input id="due_date" name="due_date" type="date" className="w-44" />
            </FormRow>
            <div className="flex justify-end">
              <Button size="sm" type="submit" loading={pending}>
                Create task
              </Button>
            </div>
          </form>
        </div>
      )}

      <CardBody className="p-0">
        {tasks.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No tasks yet" description="Break the project into assignable tasks." />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {tasks.map((t) => {
              const mine = t.assigned_to === currentUserId;
              const canEdit = mine || canAssign;
              return (
                <li key={t.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">{t.title}</p>
                    <p className="text-[12px] text-text-tertiary">
                      {t.profiles?.full_name ?? "Unassigned"}
                      {t.due_date ? ` · due ${formatDate(t.due_date)}` : ""}
                    </p>
                    {t.description && (
                      <p className="mt-1 text-[12px] text-text-secondary">{t.description}</p>
                    )}
                  </div>
                  {canEdit ? (
                    <TaskStatusSelect task={t} projectId={projectId} />
                  ) : (
                    <TaskStatusBadge status={t.status} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
