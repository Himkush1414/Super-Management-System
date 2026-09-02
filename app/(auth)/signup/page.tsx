"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { signUpAction, type ActionState } from "@/lib/auth/actions";
import { AuthCard, FormAlert } from "@/components/shared/AuthCard";
import { Input, Label, FormRow, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { SELF_SELECTABLE_ROLES, ROLE_LABEL, ROLE_DESCRIPTION } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export default function SignUpPage() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    signUpAction,
    null,
  );
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [role, setRole] = useState(SELF_SELECTABLE_ROLES[0]);

  return (
    <AuthCard
      title="Request access"
      subtitle="Accounts are reviewed by an administrator before they're activated. You'll be notified once a decision is made."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/signin" className="text-accent hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form action={formAction} className="space-y-4">
        <FormAlert state={state} />

        <FormRow>
          <Label htmlFor="full_name">Full name</Label>
          <Input id="full_name" name="full_name" autoComplete="name" required />
        </FormRow>

        <div>
          <Label>Contact method</Label>
          <div className="grid grid-cols-2 gap-2">
            {(["email", "phone"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={cn(
                  "h-9 rounded-lg border text-[13px] font-medium capitalize transition-colors",
                  method === m
                    ? "border-accent/50 bg-accent/10 text-text"
                    : "border-border-strong text-text-secondary hover:text-text",
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <input type="hidden" name="contact_method" value={method} />
        </div>

        <FormRow>
          <Label htmlFor="contact">
            {method === "email" ? "Email address" : "Phone number"}
          </Label>
          <Input
            id="contact"
            name="contact"
            type={method === "email" ? "email" : "tel"}
            autoComplete={method === "email" ? "email" : "tel"}
            required
          />
          {method === "phone" && (
            <p className="text-[12px] text-status-warning">
              Phone registration is being enabled — use email for now.
            </p>
          )}
        </FormRow>

        <FormRow>
          <Label htmlFor="password" hint="min 8 characters">
            Password
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </FormRow>

        <FormRow>
          <Label htmlFor="requested_role">Requested role</Label>
          <Select
            id="requested_role"
            name="requested_role"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            {SELF_SELECTABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
          <p className="text-[12px] text-text-tertiary">{ROLE_DESCRIPTION[role]}</p>
        </FormRow>

        <Button
          type="submit"
          className="w-full"
          loading={pending}
          disabled={method === "phone"}
        >
          Submit request
        </Button>
      </form>
    </AuthCard>
  );
}
