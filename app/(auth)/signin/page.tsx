"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction, type ActionState } from "@/lib/auth/actions";
import { AuthCard, FormAlert } from "@/components/shared/AuthCard";
import { Input, Label, FormRow } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function SignInPage() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    loginAction,
    null,
  );

  return (
    <AuthCard
      title="Log in"
      subtitle="Enter your password. If your account uses email, we'll send a one-time code as a second step."
      footer={
        <>
          Need access?{" "}
          <Link href="/signup" className="text-accent hover:underline">
            Request an account
          </Link>
        </>
      }
    >
      <form action={formAction} className="space-y-4">
        <FormAlert state={state} />
        <FormRow>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </FormRow>
        <FormRow>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </FormRow>
        <Button type="submit" className="w-full" loading={pending}>
          Continue
        </Button>
      </form>

      <p className="mt-4 rounded-lg bg-bg-subtle p-3 text-[12px] leading-relaxed text-text-tertiary">
        Demo: <span className="tnum">headadmin@demo.nrindustries.local</span> ·
        password <span className="tnum">DemoPass123!</span> (demo accounts skip
        the second factor).
      </p>
    </AuthCard>
  );
}
