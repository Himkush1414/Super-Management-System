"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  startSignup,
  verifySignupOtp,
  setSignupPassword,
  type WizardState,
} from "@/lib/auth/actions";
import { AuthCard, FormAlert } from "@/components/shared/AuthCard";
import { Input, Label, FormRow } from "@/components/ui/Field";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type Method = "email" | "phone";
type Step = "identity" | "otp" | "password";

export default function SignUpPage() {
  const [step, setStep] = useState<Step>("identity");
  const [fullName, setFullName] = useState("");
  const [method, setMethod] = useState<Method>("email");
  const [contact, setContact] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [state, setState] = useState<WizardState>(null);
  const [pending, start] = useTransition();

  function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setState(null);
    start(async () => {
      const r = await startSignup({ fullName, method, contact });
      setState(r);
      if (!r?.error) {
        setDevCode(r?.devCode ?? null);
        setStep("otp");
      }
    });
  }

  function verify(e: React.FormEvent) {
    e.preventDefault();
    setState(null);
    start(async () => {
      const r = await verifySignupOtp({ method, contact, token });
      setState(r);
      if (!r?.error) setStep("password");
    });
  }

  function finish(e: React.FormEvent) {
    e.preventDefault();
    setState(null);
    start(async () => {
      const r = await setSignupPassword({ fullName, method, contact, password });
      // Success redirects server-side — any return here is an error.
      if (r) setState(r);
    });
  }

  return (
    <AuthCard
      title="Request access"
      subtitle="Accounts are reviewed before they're activated. You'll be notified once a decision is made."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/signin" className="text-accent hover:underline">
            Log in
          </Link>
        </>
      }
    >
      {step === "identity" && (
        <form onSubmit={sendOtp} className="space-y-4">
          <FormAlert state={state} />

          <FormRow>
            <Label htmlFor="full_name">Full name</Label>
            <Input
              id="full_name"
              autoComplete="name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </FormRow>

          <div>
            <Label>Contact method</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["email", "phone"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMethod(m);
                    setContact("");
                  }}
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
          </div>

          <FormRow>
            <Label htmlFor="contact">{method === "email" ? "Email address" : "Phone number"}</Label>
            <Input
              id="contact"
              type={method === "email" ? "email" : "tel"}
              autoComplete={method === "email" ? "email" : "tel"}
              required
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            />
          </FormRow>

          <Button type="submit" className="w-full" loading={pending}>
            Next
          </Button>
        </form>
      )}

      {step === "otp" && (
        <form onSubmit={verify} className="space-y-4">
          <FormAlert state={state} />
          <p className="text-[13px] text-text-secondary">
            {method === "email"
              ? `We sent a 6-digit code to ${contact}.`
              : `Enter the 6-digit code sent to ${contact}.`}
          </p>
          {devCode && (
            <p className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-2.5 text-[12px] text-status-warning">
              Dev mode — phone OTP is stubbed, no SMS is sent. Code:{" "}
              <span className="tnum font-semibold">{devCode}</span>
            </p>
          )}
          <FormRow>
            <Label htmlFor="token">Verification code</Label>
            <Input
              id="token"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              placeholder="000000"
              className="tracking-[0.5em] text-center text-lg"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </FormRow>
          <Button type="submit" className="w-full" loading={pending}>
            Verify &amp; continue
          </Button>
        </form>
      )}

      {step === "password" && (
        <form onSubmit={finish} className="space-y-4">
          <FormAlert state={state} />
          <FormRow>
            <Label htmlFor="password" hint="exactly 6 digits, numbers only">
              Set your password
            </Label>
            <PasswordInput
              id="password"
              centered
              inputMode="numeric"
              autoComplete="new-password"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="••••••"
              className="tracking-[0.5em] text-center text-lg"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value.replace(/\D/g, ""))}
            />
          </FormRow>
          <Button type="submit" className="w-full" loading={pending}>
            Create account
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
