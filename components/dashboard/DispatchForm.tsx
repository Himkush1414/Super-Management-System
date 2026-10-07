"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { Check, Phone, PhoneOff, Plus, X } from "lucide-react";
import { dispatchOrder, type Result } from "@/lib/actions/orders";
import { FormAlert } from "@/components/shared/FormAlert";
import { Input, Textarea, Label, FormRow } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import { cn, formatCurrency } from "@/lib/utils";
import { GST_PERCENT, MAX_ORDER_ITEMS, gstOf } from "@/lib/orders";

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

  // One stable key per product card. Inputs stay uncontrolled (their values
  // live in the DOM), so adding or removing a card never touches what was
  // typed in the others; only the values are tracked for the running total.
  const nextKey = useRef(1);
  const [items, setItems] = useState<number[]>([0]);
  // typed price per card + the Additional Amount, for the GST preview and
  // the running subtotal (the database recomputes all of it on save)
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [additional, setAdditional] = useState("");
  const nameRefs = useRef(new Map<number, HTMLInputElement>());
  const [focusKey, setFocusKey] = useState<number | null>(null);

  useEffect(() => {
    if (focusKey !== null) nameRefs.current.get(focusKey)?.focus();
  }, [focusKey]);

  const add = () => {
    if (items.length >= MAX_ORDER_ITEMS) return;
    const key = nextKey.current++;
    setItems((prev) => [...prev, key]);
    setFocusKey(key);
  };
  const remove = (key: number) => {
    setItems((prev) => prev.filter((k) => k !== key));
    setPrices((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const amount = (v: string | undefined): number | null =>
    v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  /** one card's price, its GST and price + GST; null until a price is typed */
  const productAmounts = (key: number) => {
    const price = amount(prices[key]);
    if (price === null) return null;
    const gst = gstOf(price);
    return { price, gst, total: Math.round((price + gst) * 100) / 100 };
  };
  const productTotals = items.map((k) => productAmounts(k)?.total).filter((v): v is number => v !== undefined);
  const productsSum = productTotals.length
    ? Math.round(productTotals.reduce((a, b) => a + b, 0) * 100) / 100
    : null;
  const additionalAmount = amount(additional);
  const subtotal =
    productsSum === null && additionalAmount === null
      ? null
      : Math.round(((productsSum ?? 0) + (additionalAmount ?? 0)) * 100) / 100;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const notReady = production.filter((p) => picked.has(p.id) && !p.ready);

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
      className="space-y-6"
    >
      <FormAlert state={state} />

      <fieldset className="space-y-4">
        <legend className="nr-section-label">Order</legend>
        <FormRow>
          <Label htmlFor="client_name">Client name</Label>
          <Input id="client_name" name="client_name" required autoFocus maxLength={200} />
        </FormRow>
        <FormRow>
          <Label htmlFor="ship_to">Ship To</Label>
          <Textarea id="ship_to" name="ship_to" rows={2} maxLength={2000} />
        </FormRow>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormRow>
            <Label htmlFor="expected_delivery">Expected delivery</Label>
            <DateField id="expected_delivery" name="expected_delivery" min={today} />
          </FormRow>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="nr-section-label">Products</legend>
        <ol className="space-y-3">
          {items.map((key, i) => (
            <li
              key={key}
              className="space-y-4 rounded-xl border border-border bg-bg-subtle/40 p-4"
              aria-label={`Product ${i + 1}`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-medium text-text">Product {i + 1}</p>
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => remove(key)}
                    className="nr-interactive inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-text-tertiary hover:bg-status-danger/10 hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger/50"
                    aria-label={`Remove product ${i + 1}`}
                  >
                    <X size={13} /> Remove
                  </button>
                )}
              </div>
              <FormRow>
                <Label htmlFor={`product_name-${key}`}>Product name</Label>
                <Input
                  id={`product_name-${key}`}
                  name="product_name[]"
                  ref={(el) => {
                    if (el) nameRefs.current.set(key, el);
                    else nameRefs.current.delete(key);
                  }}
                  required
                  maxLength={200}
                  placeholder="e.g. Oil-cooled distribution transformer"
                />
              </FormRow>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormRow>
                  <Label htmlFor={`transformer_rating-${key}`}>Transformer rating</Label>
                  <Input
                    id={`transformer_rating-${key}`}
                    name="transformer_rating[]"
                    required
                    maxLength={120}
                    placeholder="e.g. 250 kVA, 11/0.433 kV"
                  />
                </FormRow>
                <FormRow>
                  <Label htmlFor={`quantity-${key}`}>Quantity</Label>
                  <Input
                    id={`quantity-${key}`}
                    name="quantity[]"
                    type="number"
                    min={1}
                    step={1}
                    defaultValue={1}
                    inputMode="numeric"
                    required
                  />
                </FormRow>
                <FormRow>
                  <Label htmlFor={`price-${key}`} hint="hidden from production">
                    Price
                  </Label>
                  <MoneyInput
                    id={`price-${key}`}
                    name="price[]"
                    onChange={(v) => setPrices((prev) => ({ ...prev, [key]: v }))}
                  />
                </FormRow>
                <FormRow>
                  <p className="mb-1.5 text-[13px] font-medium text-text-secondary">
                    Total incl. {GST_PERCENT}% GST
                  </p>
                  <div
                    className="flex h-9 items-center justify-end rounded-lg border border-border bg-bg-subtle/60 px-3 text-sm font-medium tnum"
                    aria-live="polite"
                  >
                    {formatCurrency(productAmounts(key)?.total)}
                  </div>
                  <p className="text-right text-[12px] text-text-tertiary tnum">
                    {productAmounts(key)
                      ? `${formatCurrency(productAmounts(key)!.price)} + GST ${formatCurrency(productAmounts(key)!.gst)}`
                      : `Price + ${GST_PERCENT}% GST`}
                  </p>
                </FormRow>
              </div>
              <FormRow>
                <Label htmlFor={`description-${key}`}>Description</Label>
                <Textarea
                  id={`description-${key}`}
                  name="description[]"
                  rows={3}
                  maxLength={4000}
                  placeholder="Anything production needs to know about this product."
                />
              </FormRow>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={add}
            disabled={items.length >= MAX_ORDER_ITEMS}
          >
            <Plus size={14} /> Add product
          </Button>
          {items.length >= MAX_ORDER_ITEMS && (
            <span className="text-[12px] text-text-tertiary">
              An order can have at most {MAX_ORDER_ITEMS} products.
            </span>
          )}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="nr-section-label">Amounts</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormRow>
            <Label htmlFor="additional_amount" hint="no GST · hidden from production">
              Additional Amount
            </Label>
            <MoneyInput id="additional_amount" name="additional_amount" onChange={setAdditional} />
          </FormRow>
        </div>
        <dl className="space-y-1.5 rounded-xl border border-border bg-bg-subtle/40 p-4 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="text-text-secondary">
              Products (price + {GST_PERCENT}% GST
              {items.length > 1 ? `, ${items.length} products` : ""})
            </dt>
            <dd className="tnum">{formatCurrency(productsSum)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-text-secondary">Additional Amount added</dt>
            <dd className="tnum">{additionalAmount === null ? "—" : `+ ${formatCurrency(additionalAmount)}`}</dd>
          </div>
          <div className="flex justify-between gap-3 border-t border-border pt-1.5 font-medium">
            <dt>Order subtotal (incl. {GST_PERCENT}% GST, Additional Amount added)</dt>
            <dd className="tnum">{formatCurrency(subtotal)}</dd>
          </div>
        </dl>
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
          {items.length === 1 ? "Proceed with product" : `Proceed with ${items.length} products`}
        </Button>
      </div>
    </form>
  );
}

/** ₹-prefixed amount input (price, Additional Amount). Uncontrolled; reports what's typed. */
function MoneyInput({
  id,
  name,
  onChange,
}: {
  id: string;
  name: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-text-tertiary">
        ₹
      </span>
      <Input
        id={id}
        name={name}
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        placeholder="0.00"
        className="pl-7"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
