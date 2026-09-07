"use client";

import { useActionState } from "react";
import { dispatchOrder, type Result } from "@/lib/actions/orders";
import { FormAlert } from "@/components/shared/FormAlert";
import { Input, Textarea, Select, Label, FormRow } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

type Prod = { id: string; full_name: string; hasPhone: boolean };

export function DispatchForm({ production }: { production: Prod[] }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(
    dispatchOrder,
    null,
  );

  return (
    <form action={action} className="space-y-5">
      <FormAlert state={state} />

      <FormRow>
        <Label htmlFor="product_name">Product name</Label>
        <Input id="product_name" name="product_name" required autoFocus />
      </FormRow>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormRow>
          <Label htmlFor="quality">Quality</Label>
          <Input id="quality" name="quality" placeholder="e.g. Grade A / IS 2026" />
        </FormRow>
        <FormRow>
          <Label htmlFor="quantity">Quantity</Label>
          <Input
            id="quantity"
            name="quantity"
            type="number"
            min={1}
            step={1}
            defaultValue={1}
            required
          />
        </FormRow>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormRow>
          <Label htmlFor="power_type">Power / type</Label>
          <Input id="power_type" name="power_type" placeholder="e.g. 250 kVA distribution" />
        </FormRow>
        <FormRow>
          <Label htmlFor="price" hint="hidden from production">
            Price
          </Label>
          <Input
            id="price"
            name="price"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
          />
        </FormRow>
      </div>

      <FormRow>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          rows={4}
          placeholder="Anything production needs to know about this order."
        />
      </FormRow>

      <FormRow>
        <Label htmlFor="assigned_to">Send to production</Label>
        <Select id="assigned_to" name="assigned_to" required defaultValue="">
          <option value="" disabled>
            Choose a production team…
          </option>
          {production.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
              {p.hasPhone ? "" : " — no phone registered yet"}
            </option>
          ))}
        </Select>
        <p className="mt-1.5 text-[12px] text-text-tertiary">
          If that team hasn&apos;t registered a phone number yet, the order is
          still created and starts automatically once they do.
        </p>
      </FormRow>

      <div className="flex justify-end border-t border-border pt-4">
        <Button type="submit" loading={pending}>
          Proceed with product
        </Button>
      </div>
    </form>
  );
}
