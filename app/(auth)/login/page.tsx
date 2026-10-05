"use client";

import { useActionState, useState } from "react";
import { loginAction, type ActionState } from "@/lib/auth/actions";
import { Logo } from "@/components/shared/Logo";
import { FormAlert } from "@/components/shared/FormAlert";
import { Input, Label, FormRow } from "@/components/ui/Field";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    loginAction,
    null,
  );
  // Controlled so a failed attempt keeps the username (React resets
  // uncontrolled fields after a form action); the PIN is cleared on purpose.
  const [username, setUsername] = useState("");

  return (
    <div className="rounded-2xl border border-border bg-panel/70 p-7 backdrop-blur-sm nr-fade-in">
      <div className="flex justify-center text-text">
        <Logo />
      </div>
      <h1 className="mt-6 text-center text-[15px] font-semibold tracking-tight">
        Sign in
      </h1>
      <p className="mt-1 text-center text-[13px] text-text-secondary">
        Enter your username and 6-digit PIN.
      </p>

      <form action={formAction} className="mt-6 space-y-4">
        <FormAlert state={state} />
        <FormRow>
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            required
          />
        </FormRow>
        <FormRow>
          <Label htmlFor="pin">PIN</Label>
          <PasswordInput
            id="pin"
            name="pin"
            autoComplete="current-password"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            minLength={6}
            title="6 digits"
            className="tracking-[0.35em] font-mono"
            required
          />
        </FormRow>
        <Button type="submit" className="w-full" loading={pending}>
          Sign in
        </Button>
      </form>
    </div>
  );
}
