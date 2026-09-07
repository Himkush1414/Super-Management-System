"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { saveProductionPhone, type Result } from "@/lib/actions/production";
import { FormAlert } from "@/components/shared/FormAlert";
import { Input, Label, FormRow } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export function PhoneForm({
  phone,
  confirmedAt,
}: {
  phone: string | null;
  confirmedAt: string | null;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(
    saveProductionPhone,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <FormAlert state={state} />

      {phone && confirmedAt && !state && (
        <p className="flex items-center gap-1.5 text-[13px] text-status-success">
          <CheckCircle2 size={14} /> Registered — this number is on file.
        </p>
      )}

      <FormRow>
        <Label htmlFor="phone">WhatsApp phone number</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+91 98765 43210"
          defaultValue={phone ?? ""}
          required
        />
        <p className="mt-1.5 text-[12px] text-text-tertiary">
          Used to create the WhatsApp group for every order assigned to you.
          Include the country code.
        </p>
      </FormRow>

      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={pending}>
          {phone ? "Update & confirm" : "Save & confirm"}
        </Button>
      </div>
    </form>
  );
}
