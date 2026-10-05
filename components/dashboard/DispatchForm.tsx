"use client";

import { useActionState, useState } from "react";
import { Check, Phone, PhoneOff } from "lucide-react";
import { dispatchOrder, type Result } from "@/lib/actions/orders";
import { FormAlert } from "@/components/shared/FormAlert";
import { Input, Textarea, Label, FormRow } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type Prod = { id: string; label: string; ready: boolean };

export function DispatchForm({
  production,
  today,
}: {
  production: Prod[];
  /** YYYY-MM-DD, from the server, so the date picker can't offer past days. */
  today: string;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(
    dispatchOrder,
    null,
  );
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const notReady = production.filter((p) => picked.has(p.id) && !p.ready);

  return (
    <form action={action} className="space-y-6">
      <FormAlert state={state} />

      <fieldset className="space-y-4">
        <legend className="nr-section-label">Order</legend>
        <FormRow>
          <Label htmlFor="product_name">Product name</Label>
          <Input
            id="product_name"
            name="product_name"
            required
            autoFocus
            maxLength={200}
            placeholder="e.g. Oil-cooled distribution transformer"
          />
        </FormRow>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormRow>
            <Label htmlFor="client_name">Client name</Label>
            <Input id="client_name" name="client_name" required maxLength={200} />
          </FormRow>
          <FormRow>
            <Label htmlFor="transformer_rating">Transformer rating</Label>
            <Input
              id="transformer_rating"
              name="transformer_rating"
              required
              maxLength={120}
              placeholder="e.g. 250 kVA, 11/0.433 kV"
            />
          </FormRow>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormRow>
            <Label htmlFor="quantity">Quantity</Label>
            <Input
              id="quantity"
              name="quantity"
              type="number"
              min={1}
              step={1}
              defaultValue={1}
              inputMode="numeric"
              required
            />
          </FormRow>
          <FormRow>
            <Label htmlFor="price" hint="hidden from production">
              Order value
            </Label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-text-tertiary">
                ₹
              </span>
              <Input
                id="price"
                name="price"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                className="pl-7"
              />
            </div>
          </FormRow>
          <FormRow>
            <Label htmlFor="expected_delivery">Expected delivery</Label>
            <Input id="expected_delivery" name="expected_delivery" type="date" min={today} />
          </FormRow>
        </div>
        <FormRow>
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            rows={4}
            maxLength={4000}
            placeholder="Anything production needs to know about this order."
          />
        </FormRow>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="nr-section-label">Send to production</legend>
        <p className="-mt-1 text-[12px] text-text-tertiary">
          Pick the specific member(s) who should build this. Only they will see it.
        </p>
        {production.length === 0 ? (
          <p className="text-[13px] text-text-secondary">No production accounts exist.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {production.map((p) => {
              const on = picked.has(p.id);
              return (
                <label
                  key={p.id}
                  className={cn(
                    "nr-interactive flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5",
                    "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/50",
                    on
                      ? "border-accent/60 bg-accent/[0.07]"
                      : "border-border-strong bg-bg-subtle hover:border-white/25",
                  )}
                >
                  <input
                    type="checkbox"
                    name="assigned_to"
                    value={p.id}
                    checked={on}
                    onChange={() => toggle(p.id)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded border",
                      on ? "border-accent bg-accent text-accent-fg" : "border-border-strong",
                    )}
                  >
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {p.label}
                  </span>
                  {p.ready ? (
                    <Phone size={13} className="shrink-0 text-status-success" aria-label="Ready: name and phone on file" />
                  ) : (
                    <PhoneOff size={13} className="shrink-0 text-status-warning" aria-label="Setup not finished" />
                  )}
                </label>
              );
            })}
          </div>
        )}
        {notReady.length > 0 && (
          <p className="text-[12px] text-status-warning">
            {notReady.map((p) => p.label).join(", ")}{" "}
            {notReady.length === 1 ? "hasn't" : "haven't"} finished account setup (real name and
            phone number). The order is still created but can&apos;t start until every selected
            member has done so.
          </p>
        )}
      </fieldset>

      <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[12px] text-text-tertiary">
          {picked.size === 0
            ? "Select at least one production member."
            : `Sending to ${picked.size} member${picked.size === 1 ? "" : "s"}.`}
        </p>
        <Button type="submit" loading={pending} disabled={picked.size === 0} className="w-full sm:w-auto">
          Proceed with product
        </Button>
      </div>
    </form>
  );
}
