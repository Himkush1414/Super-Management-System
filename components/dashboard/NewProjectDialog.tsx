"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { createProject, type Result } from "@/lib/actions/projects";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select, Label, FormRow } from "@/components/ui/Field";
import { FormAlert } from "@/components/shared/AuthCard";
import { TransformerKinds } from "@/lib/constants";

export function NewProjectDialog({ canSeePricing }: { canSeePricing: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<Result | null, FormData>(
    createProject,
    null,
  );

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={15} /> New project
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New project / order"
        description="Structured transformer specification. You can refine everything later."
        wide
      >
        <form action={formAction} className="space-y-4">
          <FormAlert state={state} />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow>
              <Label htmlFor="name">Project name</Label>
              <Input id="name" name="name" required />
            </FormRow>
            <FormRow>
              <Label htmlFor="client_name">Client</Label>
              <Input id="client_name" name="client_name" />
            </FormRow>
          </div>
          <FormRow>
            <Label htmlFor="client_contact">Client contact</Label>
            <Input id="client_contact" name="client_contact" />
          </FormRow>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormRow>
              <Label htmlFor="transformer_kind">Type</Label>
              <Select id="transformer_kind" name="transformer_kind" defaultValue="distribution">
                {TransformerKinds.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </FormRow>
            <FormRow>
              <Label htmlFor="capacity_kva">Capacity (kVA)</Label>
              <Input id="capacity_kva" name="capacity_kva" type="number" step="any" />
            </FormRow>
            <FormRow>
              <Label htmlFor="quantity">Quantity</Label>
              <Input id="quantity" name="quantity" type="number" min={1} defaultValue={1} />
            </FormRow>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <FormRow>
              <Label htmlFor="primary_voltage">Primary V</Label>
              <Input id="primary_voltage" name="primary_voltage" placeholder="11 kV" />
            </FormRow>
            <FormRow>
              <Label htmlFor="secondary_voltage">Secondary V</Label>
              <Input id="secondary_voltage" name="secondary_voltage" placeholder="433 V" />
            </FormRow>
            <FormRow>
              <Label htmlFor="phase">Phase</Label>
              <Select id="phase" name="phase" defaultValue="3">
                <option value="3">3-phase</option>
                <option value="1">1-phase</option>
              </Select>
            </FormRow>
            <FormRow>
              <Label htmlFor="cooling_type">Cooling</Label>
              <Input id="cooling_type" name="cooling_type" placeholder="ONAN" />
            </FormRow>
          </div>

          <FormRow>
            <Label htmlFor="requirements_notes">Requirements</Label>
            <Textarea
              id="requirements_notes"
              name="requirements_notes"
              rows={3}
              placeholder="Standards, inspection, delivery window, special construction…"
            />
          </FormRow>

          {canSeePricing && (
            <div className="rounded-lg border border-border bg-bg-subtle p-3">
              <p className="mb-3 text-[12px] font-medium text-text-secondary">
                Pricing (restricted — not visible to Product Supervisor or Maker)
              </p>
              <div className="grid gap-4 sm:grid-cols-4">
                <FormRow>
                  <Label htmlFor="unit_price">Unit price</Label>
                  <Input id="unit_price" name="unit_price" type="number" step="any" />
                </FormRow>
                <FormRow>
                  <Label htmlFor="material_cost">Material</Label>
                  <Input id="material_cost" name="material_cost" type="number" step="any" />
                </FormRow>
                <FormRow>
                  <Label htmlFor="labour_cost">Labour</Label>
                  <Input id="labour_cost" name="labour_cost" type="number" step="any" />
                </FormRow>
                <FormRow>
                  <Label htmlFor="margin">Margin</Label>
                  <Input id="margin" name="margin" type="number" step="any" />
                </FormRow>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Create project
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
