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
          <Label htmlFor="identifier">Email or phone</Label>
          <Input id="identifier" name="identifier" autoComplete="username" required />
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
    </AuthCard>
  );
}
