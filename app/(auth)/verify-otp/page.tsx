"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import {
  verifyOtpAction,
  resendOtpAction,
  type ActionState,
} from "@/lib/auth/actions";
import { AuthCard, FormAlert } from "@/components/shared/AuthCard";
import { Input, Label, FormRow } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

function VerifyForm() {
  const email = useSearchParams().get("email") ?? "";
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    verifyOtpAction,
    null,
  );
  const [resendState, resendAction, resending] = useActionState<
    ActionState,
    FormData
  >(resendOtpAction, null);

  return (
    <AuthCard
      title="Enter your code"
      subtitle={
        email
          ? `We sent a 6-digit code to ${email}. It expires shortly.`
          : "Enter the 6-digit code sent to your email."
      }
    >
      <form action={formAction} className="space-y-4">
        <FormAlert state={state ?? resendState} />
        <input type="hidden" name="email" value={email} />
        <FormRow>
          <Label htmlFor="token">Verification code</Label>
          <Input
            id="token"
            name="token"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            pattern="[0-9]{6}"
            placeholder="000000"
            className="tracking-[0.5em] text-center text-lg"
            required
          />
        </FormRow>
        <Button type="submit" className="w-full" loading={pending}>
          Verify &amp; continue
        </Button>
      </form>

      <form action={resendAction} className="mt-3 text-center">
        <input type="hidden" name="email" value={email} />
        <button
          type="submit"
          disabled={resending}
          className="text-[13px] text-text-secondary hover:text-text disabled:opacity-50"
        >
          {resending ? "Sending…" : "Resend code"}
        </button>
      </form>
    </AuthCard>
  );
}

export default function VerifyOtpPage() {
  return (
    <Suspense fallback={<AuthCard title="Enter your code">Loading…</AuthCard>}>
      <VerifyForm />
    </Suspense>
  );
}
