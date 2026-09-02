"use client";

import { useActionState } from "react";
import { updateProfile, type Result } from "@/lib/actions/account";
import { Input, Label, FormRow } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/shared/AuthCard";

export function ProfileForm({
  fullName,
  phone,
}: {
  fullName: string;
  phone: string;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(
    updateProfile,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <FormAlert state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormRow>
          <Label htmlFor="full_name">Full name</Label>
          <Input id="full_name" name="full_name" defaultValue={fullName} required />
        </FormRow>
        <FormRow>
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" type="tel" defaultValue={phone} />
        </FormRow>
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={pending}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
