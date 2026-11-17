"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { parsePaise, parseQty } from "@/lib/inventory/numbers";
import { addProduct } from "@/lib/inventory/actions";
import type { InvColumn } from "@/lib/inventory/types";
import { Field, FieldLabel } from "./bits";
import { CustomInputs } from "./ProductPanel";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { monthLabel, type Row } from "./model";

export function AddProductSheet({
  open,
  onClose,
  rows,
  formCols,
  month,
}: {
  open: boolean;
  onClose: () => void;
  rows: Row[];
  formCols: InvColumn[];
  month: string;
}) {
  const uid = useId();
  const toast = useToast();
  const savingRef = useRef(false);
  const [serial, setSerial] = useState("");
  const [description, setDescription] = useState("");
  const [specification, setSpecification] = useState("");
  const [rate, setRate] = useState("");
  const [opening, setOpening] = useState("");
  const [minStock, setMinStock] = useState("");
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const serials = useMemo(() => new Map(rows.map((r) => [r.serial_no.trim().toUpperCase(), r])), [rows]);
  const dup = serial.trim() ? serials.get(serial.trim().toUpperCase()) : undefined;
  const serialError = dup
    ? `${dup.serial_no} already exists${dup.is_active ? "" : " (archived — restore it instead)"}.`
    : tried && !serial.trim()
      ? "Enter a serial number."
      : null;
  const descError = tried && !description.trim() ? "Enter a material description." : null;
  const rateError = rate.trim() && (parsePaise(rate) === null || parsePaise(rate)! < BigInt(0)) ? "A number with at most 2 decimals." : null;
  const openingError =
    opening.trim() && (parseQty(opening) === null || parseQty(opening)! < BigInt(0)) ? "0 or more, at most 3 decimals." : null;
  const minError = minStock.trim() && (parseQty(minStock) === null || parseQty(minStock)! < BigInt(0)) ? "0 or more, at most 3 decimals." : null;

  function reset() {
    setSerial("");
    setDescription("");
    setSpecification("");
    setRate("");
    setOpening("");
    setMinStock("");
    setCustom({});
    setError(null);
    setTried(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (savingRef.current || dup || !serial.trim() || !description.trim() || rateError || openingError || minError) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      // the action re-renders the page in the same response (no second request)
      const res = await addProduct({ serialNo: serial, description, specification, rate, openingQty: opening, custom, minStock });
      if (res.ok) {
        toast("success", `${serial.trim()} added.`);
        reset();
        onClose();
      } else setError(res.error);
    } catch {
      setError("No answer from the server. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const err = (id: string, msg: string | null) =>
    msg ? (
      <p id={id} className="mt-1.5 text-[12.5px] text-status-danger">
        {msg}
      </p>
    ) : null;

  return (
    <Sheet open={open} onClose={onClose} busy={saving} wide title="Add product" description={`The opening balance counts from ${monthLabel(month)} and can't be changed later.`}>
      <form onSubmit={submit} noValidate className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,2fr)]">
          <div>
            <FieldLabel htmlFor={`${uid}-s`}>Serial No</FieldLabel>
            <Field
              id={`${uid}-s`}
              value={serial}
              maxLength={40}
              autoCapitalize="characters"
              autoComplete="off"
              onChange={(e) => setSerial(e.target.value)}
              aria-invalid={Boolean(serialError)}
              aria-describedby={serialError ? `${uid}-se` : undefined}
              data-autofocus
            />
            {err(`${uid}-se`, serialError)}
          </div>
          <div>
            <FieldLabel htmlFor={`${uid}-d`}>Material description</FieldLabel>
            <Field
              id={`${uid}-d`}
              value={description}
              maxLength={300}
              onChange={(e) => setDescription(e.target.value)}
              aria-invalid={Boolean(descError)}
              aria-describedby={descError ? `${uid}-de` : undefined}
            />
            {err(`${uid}-de`, descError)}
          </div>
        </div>
        <div>
          <FieldLabel htmlFor={`${uid}-sp`} hint="Optional">
            Specification
          </FieldLabel>
          <Field id={`${uid}-sp`} value={specification} maxLength={300} onChange={(e) => setSpecification(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor={`${uid}-r`} hint="₹ per unit">
              Rate
            </FieldLabel>
            <Field
              id={`${uid}-r`}
              inputMode="decimal"
              className="tnum"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              aria-invalid={Boolean(rateError)}
              aria-describedby={rateError ? `${uid}-re` : undefined}
            />
            {err(`${uid}-re`, rateError)}
          </div>
          <div>
            <FieldLabel htmlFor={`${uid}-o`} hint="Stock on hand now">
              Opening balance
            </FieldLabel>
            <Field
              id={`${uid}-o`}
              inputMode="decimal"
              className="tnum"
              placeholder="0"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              aria-invalid={Boolean(openingError)}
              aria-describedby={openingError ? `${uid}-oe` : undefined}
            />
            {err(`${uid}-oe`, openingError)}
          </div>
          <div className="sm:col-span-2">
            <FieldLabel htmlFor={`${uid}-m`} hint="Optional · alert when the balance falls below it">
              Minimum stock
            </FieldLabel>
            <Field
              id={`${uid}-m`}
              inputMode="decimal"
              className="tnum"
              value={minStock}
              onChange={(e) => setMinStock(e.target.value)}
              aria-invalid={Boolean(minError)}
              aria-describedby={minError ? `${uid}-me` : undefined}
            />
            {err(`${uid}-me`, minError)}
          </div>
        </div>
        <CustomInputs cols={formCols} values={custom} onChange={setCustom} idPrefix={uid} />
        {error && (
          <p role="alert" className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-[13px] text-status-danger">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" size="lg" className="h-11" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="lg" className="h-11" loading={saving} disabled={Boolean(dup)}>
            {saving ? "Adding…" : "Add product"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
