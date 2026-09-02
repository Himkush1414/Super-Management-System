"use client";

import { useState } from "react";
import { Check, Mail, MapPin, Phone } from "lucide-react";
import { Input, Textarea, Label, FormRow } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function ContactPage() {
  const [sent, setSent] = useState(false);

  return (
    <div className="mx-auto max-w-5xl px-5">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Contact</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-text-secondary">
          Send us the ratings, standard and site conditions. Engineering
          responds to technical enquiries within two working days.
        </p>
      </header>

      <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6 text-[14px]">
          <div className="flex items-start gap-3">
            <Mail size={18} className="mt-0.5 text-accent" />
            <div>
              <p className="font-medium">Email</p>
              <p className="text-text-secondary">engineering@nrindustries.example</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Phone size={18} className="mt-0.5 text-accent" />
            <div>
              <p className="font-medium">Phone</p>
              <p className="text-text-secondary">+91 20 0000 0000</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MapPin size={18} className="mt-0.5 text-accent" />
            <div>
              <p className="font-medium">Works</p>
              <p className="text-text-secondary">
                Plot 14, MIDC Industrial Area
                <br />
                Pune, Maharashtra
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-panel/60 p-6">
          {sent ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <span className="inline-flex size-11 items-center justify-center rounded-full bg-status-success/10 text-status-success">
                <Check size={20} />
              </span>
              <p className="mt-4 text-[15px] font-medium">Enquiry received</p>
              <p className="mt-1 max-w-xs text-[13px] text-text-secondary">
                Thank you. Our team will get back to you at the address you
                provided.
              </p>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setSent(true);
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <FormRow>
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" required />
                </FormRow>
                <FormRow>
                  <Label htmlFor="org">Organisation</Label>
                  <Input id="org" name="org" />
                </FormRow>
              </div>
              <FormRow>
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
              </FormRow>
              <FormRow>
                <Label htmlFor="msg" hint="ratings, standard, quantity, timeline">
                  Requirement
                </Label>
                <Textarea id="msg" name="msg" rows={5} required />
              </FormRow>
              <Button type="submit" className="w-full">
                Send enquiry
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
