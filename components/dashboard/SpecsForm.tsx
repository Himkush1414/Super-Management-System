"use client";

import { useActionState } from "react";
import { updateProjectFields, type Result } from "@/lib/actions/projects";
import { Input, Textarea, Label, FormRow } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/shared/AuthCard";
import type { Project } from "@/types/database.types";

export function SpecsForm({ project }: { project: Project }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(
    updateProjectFields,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <FormAlert state={state} />
      <input type="hidden" name="project_id" value={project.id} />
      <div className="grid gap-4 sm:grid-cols-3">
        <FormRow>
          <Label htmlFor="capacity_kva">Capacity (kVA)</Label>
          <Input
            id="capacity_kva"
            name="capacity_kva"
            type="number"
            step="any"
            defaultValue={project.capacity_kva ?? ""}
          />
        </FormRow>
        <FormRow>
          <Label htmlFor="primary_voltage">Primary voltage</Label>
          <Input id="primary_voltage" name="primary_voltage" defaultValue={project.primary_voltage ?? ""} />
        </FormRow>
        <FormRow>
          <Label htmlFor="secondary_voltage">Secondary voltage</Label>
          <Input id="secondary_voltage" name="secondary_voltage" defaultValue={project.secondary_voltage ?? ""} />
        </FormRow>
        <FormRow>
          <Label htmlFor="cooling_type">Cooling</Label>
          <Input id="cooling_type" name="cooling_type" defaultValue={project.cooling_type ?? ""} />
        </FormRow>
        <FormRow>
          <Label htmlFor="impedance_pct">Impedance (%)</Label>
          <Input
            id="impedance_pct"
            name="impedance_pct"
            type="number"
            step="any"
            defaultValue={project.impedance_pct ?? ""}
          />
        </FormRow>
      </div>
      <FormRow>
        <Label htmlFor="requirements_notes">Requirements & quality notes</Label>
        <Textarea
          id="requirements_notes"
          name="requirements_notes"
          rows={4}
          defaultValue={project.requirements_notes}
        />
      </FormRow>
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={pending}>
          Save specification
        </Button>
      </div>
    </form>
  );
}
