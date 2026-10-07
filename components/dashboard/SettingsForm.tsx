"use client";

import { startTransition, useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { saveSettings, type Result } from "@/lib/actions/settings";
import { FormAlert } from "@/components/shared/FormAlert";
import { Input, Label, FormRow } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export function SettingsForm({
  role,
  accountLabel,
  realName,
  phone,
  phoneConfirmed,
}: {
  role: "marketing" | "production";
  accountLabel: string;
  realName: string | null;
  phone: string | null;
  phoneConfirmed: boolean;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(saveSettings, null);
  const isProduction = role === "production";
  const complete = Boolean(realName) && (!isProduction || phoneConfirmed);

  return (
    <form
      // Submit via onSubmit, not <form action>: React resets a form after a
      // form action completes, which wiped everything typed whenever the
      // server rejected the input. Dispatching the action ourselves keeps it.
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
      className="space-y-5"
    >
      <FormAlert state={state} />

      {complete && !state && (
        <p className="flex items-center gap-1.5 text-[13px] text-status-success">
          <CheckCircle2 size={14} /> Your details are on file.
        </p>
      )}

      <FormRow>
        <Label htmlFor="real_name">Your real name</Label>
        <Input
          id="real_name"
          name="real_name"
          defaultValue={realName ?? ""}
          autoComplete="name"
          autoFocus={!realName}
          required
          minLength={2}
          maxLength={80}
          placeholder="e.g. Manik Rana"
        />
        <p className="mt-1.5 text-[12px] text-text-tertiary">
          Shown to others as <span className="text-text-secondary">Your Name ({accountLabel})</span> on
          orders, exports and the activity log.
        </p>
      </FormRow>

      {isProduction && (
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
            Used to create the WhatsApp group for every order assigned to you. Include the country
            code. Orders assigned to you can&apos;t start until your name and number are both saved.
          </p>
        </FormRow>
      )}

      <div className="flex justify-end">
        <Button type="submit" loading={pending} className="w-full sm:w-auto">
          {complete ? "Save changes" : "Save and continue"}
        </Button>
      </div>
    </form>
  );
}
