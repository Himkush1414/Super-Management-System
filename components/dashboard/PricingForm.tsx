"use client";

import { useActionState } from "react";
import { updateProjectFields, type Result } from "@/lib/actions/projects";
import { Input, Label, FormRow } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/shared/AuthCard";
import type { Project } from "@/types/database.types";

export function PricingForm({ project }: { project: Project }) {
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
          <Label htmlFor="unit_price">Unit price (₹)</Label>
          <Input id="unit_price" name="unit_price" type="number" step="any" defaultValue={project.unit_price ?? ""} />
        </FormRow>
        <FormRow>
          <Label htmlFor="quantity">Quantity</Label>
          <Input id="quantity" name="quantity" type="number" min={1} defaultValue={project.quantity} />
        </FormRow>
        <FormRow>
          <Label htmlFor="margin">Margin (₹)</Label>
          <Input id="margin" name="margin" type="number" step="any" defaultValue={project.margin ?? ""} />
        </FormRow>
        <FormRow>
          <Label htmlFor="material_cost">Material cost (₹)</Label>
          <Input id="material_cost" name="material_cost" type="number" step="any" defaultValue={project.material_cost ?? ""} />
        </FormRow>
        <FormRow>
          <Label htmlFor="labour_cost">Labour cost (₹)</Label>
          <Input id="labour_cost" name="labour_cost" type="number" step="any" defaultValue={project.labour_cost ?? ""} />
        </FormRow>
      </div>
      <p className="text-[12px] text-text-tertiary">
        Every price change is written to the audit log with your name, timestamp,
        and before/after values.
      </p>
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={pending}>
          Save pricing
        </Button>
      </div>
    </form>
  );
}
