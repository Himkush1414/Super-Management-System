"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileUp, FileText, CheckCircle2, TriangleAlert, ArrowLeft, RotateCcw, ChevronDown, Info } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatINR, formatQty, paiseToText, parsePaise, parseQty, qtyToText } from "@/lib/inventory/numbers";
import { applyImport, type ImportInput } from "@/lib/inventory/actions";
import { LIMITS, type ReadResult } from "@/lib/inventory/sheet-read";
import { FIELDS, FIELD_LABEL, detectColumns, planImport, serialKey, toRecords, type Detected, type KnownProduct, type Mapping, type Plan } from "@/lib/inventory/sheet-map";
import { cn } from "@/lib/utils";
import { newKey } from "../bits";
import { Sheet } from "../Sheet";
import { readError, readPickedFile, stopPdfWorker } from "./browser-io";

export type ImportProduct = Omit<KnownProduct, "ratePaise" | "balance"> & { rate: string | null; balance: string };

type Props = {
  products: ImportProduct[];
  /** month-start counting applies this month (balances become stock counts) */
  countsAllowed: boolean;
  countsFrom: string;
};

/**
 * What the picker offers. The Android app's WebView (react-native-webview)
 * turns this list into the system picker's MIME filter, and some phones
 * label a CSV as text/plain or application/vnd.ms-excel, so those are
 * listed too; the file's real kind is decided from its bytes anyway.
 */
const ACCEPT = [
  ".pdf", ".docx", ".xlsx", ".csv",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv", "text/comma-separated-values", "text/plain", "application/vnd.ms-excel",
].join(",");
const SHOW = 50;

/**
 * "Import from document": pick a file, check the columns, see the preview,
 * apply. The file is read in this browser tab's memory (lib/inventory/
 * sheet-read.ts) and never sent anywhere; only the resulting rows are, when
 * Apply is confirmed. Nothing is written before that.
 */
export function ImportFlow({ products, countsAllowed, countsFrom }: Props) {
  const router = useRouter();
  const [stage, setStage] = useState<"pick" | "reading" | "preview" | "done">("pick");
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<ReadResult | null>(null);
  const [detected, setDetected] = useState<Detected | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [fillBlanks, setFillBlanks] = useState(true);
  const [archiveMode, setArchiveMode] = useState<"keep" | "archive">("keep");
  const [toArchive, setToArchive] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applyError, setApplyError] = useState<{ text: string; stale?: boolean } | null>(null);
  const [result, setResult] = useState<Extract<Awaited<ReturnType<typeof applyImport>>, { ok: true }> | null>(null);
  const [readMs, setReadMs] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  // one key per preview: a double tap or a retry applies once; any change to the choices makes a new one
  const batch = useRef<{ key: string; fp: string } | null>(null);

  useEffect(() => () => stopPdfWorker(), []);

  const known: KnownProduct[] = useMemo(
    () => products.map((p) => ({ ...p, ratePaise: p.rate === null ? null : parsePaise(p.rate), balance: parseQty(p.balance) ?? BigInt(0) })),
    [products],
  );

  const { plan, records, tooMany } = useMemo(() => {
    if (!read || !detected || !mapping) return { plan: null as Plan | null, records: null, tooMany: false };
    try {
      const recs = toRecords(read.rows, { header: detected.header, mapping }, LIMITS.maxRows);
      return { plan: planImport(recs.records, known), records: recs, tooMany: false };
    } catch {
      return { plan: null, records: null, tooMany: true };
    }
  }, [read, detected, mapping, known]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setStage("reading");
    const t0 = performance.now();
    try {
      const r = await readPickedFile(file);
      if (input.current) input.current.value = ""; // the browser lets go of the file
      if (!r.rows.length) throw new Error("No rows were found.");
      const d = detectColumns(r.rows);
      setRead(r);
      setDetected(d);
      setMapping(d.mapping);
      setToArchive(new Set());
      setArchiveMode("keep");
      setApplyError(null);
      batch.current = null;
      setStage("preview");
      setReadMs(Math.round(performance.now() - t0));
    } catch (e) {
      if (input.current) input.current.value = "";
      setError(readError(e));
      setStage("pick");
    }
  }

  function reset() {
    setRead(null);
    setDetected(null);
    setMapping(null);
    setResult(null);
    setError(null);
    setApplyError(null);
    setStage("pick");
  }

  // what Apply would send (built from the preview only)
  const payload: ImportInput | null = useMemo(() => {
    if (!plan) return null;
    const counts = countsAllowed ? plan.matched.map((m) => ({ id: m.product.id, key: serialKey(m.product.serial_no), counted: qtyToText(m.file) })) : [];
    const added = plan.added.map((a) => ({
      serial: a.record.serial, description: a.record.description, specification: a.record.specification,
      rate: a.ratePaise === null ? null : paiseToText(a.ratePaise), balance: qtyToText(a.balance),
    }));
    const fills = fillBlanks
      ? plan.matched.filter((m) => m.fill.specification || m.fill.ratePaise !== undefined).map((m) => ({
          id: m.product.id, specification: m.fill.specification ?? null, rate: m.fill.ratePaise === undefined ? null : paiseToText(m.fill.ratePaise),
        }))
      : [];
    const archive = archiveMode === "archive" ? plan.notInFile.filter((p) => toArchive.has(p.id)).map((p) => p.id) : [];
    return { batchKey: "", rows: plan.rows, counts, added, fills, archive };
  }, [plan, countsAllowed, fillBlanks, archiveMode, toArchive]);

  async function apply() {
    if (!payload || busy.current) return;
    const fp = JSON.stringify(payload);
    if (fp.length > 1_900_000) {
      setApplyError({ text: "This import is too large to send at once. Split the file in two and import each part." });
      return;
    }
    batch.current = batch.current && batch.current.fp === fp ? batch.current : { key: newKey(), fp };
    busy.current = true;
    setSaving(true);
    setApplyError(null);
    try {
      const res = await applyImport({ ...payload, batchKey: batch.current.key });
      if (res.ok) {
        setResult(res);
        setConfirming(false);
        setStage("done");
        router.refresh();
      } else setApplyError({ text: res.error, stale: res.stale });
    } catch {
      setApplyError({ text: "No answer from the server. Check the connection and confirm again: it won't be applied twice." });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const changed = plan ? plan.matched.filter((m) => m.diff !== BigInt(0)).length : 0;
  const fillCount = payload?.fills.length ?? 0;

  return (
    <>
      <div className="mb-5">
        <Link href="/dashboard/inventory-settings" className="nr-interactive mb-2 inline-flex min-h-11 items-center gap-1.5 text-[13px] text-text-secondary hover:text-text md:min-h-0">
          <ArrowLeft size={14} /> Inventory settings
        </Link>
        <p className="nr-section-label">Store</p>
        <h1 className="text-[1.5rem] font-semibold tracking-[-0.025em]">Import from document</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-text-secondary">
          Read balances and new products from a PDF (with text), Word (.docx), Excel (.xlsx) or CSV file. The file is read on this
          device only: it is never uploaded or saved. Nothing changes until you confirm.
        </p>
      </div>

      {stage === "done" && result ? (
        <section className="rounded-xl border border-status-success/35 bg-status-success/[0.06] p-5" role="status" data-inv-import-done>
          <p className="flex items-center gap-2 text-[15px] font-semibold text-text">
            <CheckCircle2 size={18} className="text-status-success" /> {result.duplicate ? "Already applied" : "Import applied"}
          </p>
          <ul className="tnum mt-3 grid gap-1.5 text-[13.5px] text-text-secondary sm:grid-cols-2">
            <li><span className="font-semibold text-text">{result.counted}</span> balance{result.counted === 1 ? "" : "s"} recorded as stock counts ({result.adjusted} changed)</li>
            <li><span className="font-semibold text-text">{result.added}</span> new product{result.added === 1 ? "" : "s"}</li>
            <li><span className="font-semibold text-text">{result.filled}</span> empty rate / specification filled</li>
            <li><span className="font-semibold text-text">{result.archived}</span> archived (restorable from the Archive tab)</li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/dashboard/inventory" className="nr-interactive inline-flex h-11 items-center rounded-lg bg-[var(--accent-solid)] px-4 text-[14px] font-medium text-white md:h-10">
              Open Inventory
            </Link>
            <Button type="button" variant="secondary" className="h-11 md:h-10" onClick={reset}>
              Import another file
            </Button>
          </div>
        </section>
      ) : (
        <>
          <section className="rounded-xl border border-border bg-panel/60 p-5">
            <label
              className={cn(
                "nr-interactive flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border-strong px-4 py-8 text-center hover:border-accent/50",
                stage === "reading" && "pointer-events-none opacity-70",
              )}
            >
              <FileUp size={26} className="text-accent" aria-hidden />
              <span className="text-[15px] font-medium text-text">{stage === "reading" ? "Reading the file…" : read ? "Choose another file" : "Choose a file"}</span>
              <span className="text-[12.5px] text-text-tertiary">PDF with text, Word .docx, Excel .xlsx or CSV · up to {LIMITS.maxBytes / 1024 / 1024} MB · {LIMITS.maxRows.toLocaleString("en-IN")} rows</span>
              <input
                ref={input}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                aria-label="Choose a document to import"
                onChange={(e) => void pick(e.target.files?.[0])}
                disabled={stage === "reading"}
                data-inv-import-file
              />
            </label>
            <p className="mt-3 flex items-start gap-2 text-[12.5px] text-text-tertiary">
              <Info size={14} className="mt-0.5 shrink-0" /> Scans and photos can&apos;t be read: use the balance screen in Inventory instead.
            </p>
            {error && (
              <p role="alert" className="mt-3 rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-[13px] text-status-danger" data-inv-import-error>
                {error}
              </p>
            )}
          </section>

          {stage === "preview" && read && detected && mapping && (
            <>
              <section className="mt-5 rounded-xl border border-border bg-panel/60" aria-labelledby="inv-import-cols">
                <div className="border-b border-border px-5 py-3.5">
                  <h2 id="inv-import-cols" className="text-[15px] font-semibold">Columns</h2>
                  <p className="mt-1 text-[13px] text-text-secondary">
                    {read.kind.toUpperCase()} · {read.rows.length.toLocaleString("en-IN")} rows read{readMs !== null ? ` in ${(readMs / 1000).toFixed(1)} s` : ""}.{" "}
                    {detected.header >= 0 ? "Found by their headings." : "No headings found: guessed from the values."} Change any that is wrong.
                  </p>
                  {read.notes.map((n) => (
                    <p key={n} className="mt-1 text-[12.5px] text-text-tertiary">{n}</p>
                  ))}
                </div>
                <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-5">
                  {FIELDS.map((f) => (
                    <label key={f} className="text-[13px] font-medium text-text-secondary">
                      {FIELD_LABEL[f]}
                      {(f === "serial" || f === "balance") && <span className="text-status-danger"> *</span>}
                      <select
                        value={mapping[f] ?? ""}
                        onChange={(e) => {
                          const v = e.target.value === "" ? null : Number(e.target.value);
                          setMapping((m) => ({ ...(m as Mapping), [f]: v }));
                        }}
                        className="mt-1.5 h-11 w-full rounded-lg border border-border-strong bg-bg-subtle px-2 text-[14px] text-text md:h-10"
                        data-inv-map={f}
                      >
                        <option value="">— none —</option>
                        {Array.from({ length: detected.width }, (_, i) => (
                          <option key={i} value={i}>
                            {colLabel(i)}{detected.header >= 0 && read.rows[detected.header][i]?.trim() ? `: ${read.rows[detected.header][i].trim().slice(0, 28)}` : ""}
                          </option>
                        ))}
                      </select>
                      <span className="mt-1 block text-[11.5px] font-normal text-text-tertiary">{detected.how[f] === "heading" ? "by heading" : detected.how[f] === "inferred" ? "guessed" : "not found"}</span>
                    </label>
                  ))}
                </div>
              </section>

              {tooMany && (
                <p role="alert" className="mt-4 rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-[13px] text-status-danger">
                  The file has more than {LIMITS.maxRows.toLocaleString("en-IN")} rows. Split it and import each part.
                </p>
              )}
              {mapping.balance === null && (
                <p role="alert" className="mt-4 rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-[13px] text-status-warning">
                  Choose which column holds the balance (Balance / Qty).
                </p>
              )}

              {plan && records && (
                <Preview
                  plan={plan}
                  repeated={records.repeatedHeadings}
                  artefacts={records.artefacts}
                  countsAllowed={countsAllowed}
                  countsFrom={countsFrom}
                  fillBlanks={fillBlanks}
                  onFillBlanks={setFillBlanks}
                  archiveMode={archiveMode}
                  onArchiveMode={setArchiveMode}
                  toArchive={toArchive}
                  onToArchive={setToArchive}
                />
              )}

              {plan && (
                <div className="sticky bottom-0 z-10 -mx-4 mt-5 border-t border-border bg-bg/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="tnum mr-auto text-[12.5px] text-text-secondary">
                      {countsAllowed ? `${plan.matched.length} balances` : "0 balances"} · {plan.added.length} new · {fillCount} fills · {payload?.archive.length ?? 0} to archive · {plan.problems.length} need review
                    </p>
                    <Button type="button" variant="secondary" className="h-11 md:h-10" onClick={reset}>
                      <RotateCcw size={14} /> Start over
                    </Button>
                    <Button
                      type="button"
                      className="h-11 md:h-10"
                      disabled={!payload || mapping.balance === null || mapping.serial === null || (payload.counts.length + payload.added.length + payload.fills.length + payload.archive.length === 0)}
                      onClick={() => setConfirming(true)}
                      data-inv-import-apply
                    >
                      Review and apply
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {confirming && payload && plan && (
        <Sheet open onClose={() => !saving && setConfirming(false)} busy={saving} title="Apply this import?" description="Everything below is saved together, or nothing is.">
          <div className="space-y-4 text-[13.5px]">
            <ul className="tnum space-y-1.5 rounded-xl border border-border bg-bg-subtle px-4 py-3">
              <li><span className="font-semibold">{payload.counts.length}</span> balances recorded as <span className="font-medium">Stock count</span> ({countsAllowed ? `${changed} change the balance` : "not this month"})</li>
              <li><span className="font-semibold">{payload.added.length}</span> new products</li>
              <li><span className="font-semibold">{payload.fills.length}</span> empty rate / specification filled (never overwritten)</li>
              <li><span className="font-semibold">{payload.archive.length}</span> products not in the file archived (restorable)</li>
              <li className="text-text-tertiary"><span className="font-semibold">{plan.problems.length}</span> rows need review and are <span className="font-medium">not</span> applied</li>
            </ul>
            {applyError && (
              <p role="alert" className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-[13px] text-status-danger">
                {applyError.text}
                {applyError.stale && " Choose the file again to read it against the latest data."}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" size="lg" className="h-11" onClick={() => setConfirming(false)} disabled={saving}>
                Back
              </Button>
              <Button type="button" size="lg" className="h-11" onClick={apply} loading={saving} data-autofocus data-inv-import-confirm>
                {saving ? "Applying…" : "Apply import"}
              </Button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}

const colLabel = (i: number) => `Column ${i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26))}`;

function Preview({
  plan, repeated, artefacts, countsAllowed, countsFrom, fillBlanks, onFillBlanks, archiveMode, onArchiveMode, toArchive, onToArchive,
}: {
  plan: Plan;
  repeated: number;
  artefacts: number;
  countsAllowed: boolean;
  countsFrom: string;
  fillBlanks: boolean;
  onFillBlanks: (v: boolean) => void;
  archiveMode: "keep" | "archive";
  onArchiveMode: (v: "keep" | "archive") => void;
  toArchive: Set<string>;
  onToArchive: (v: Set<string>) => void;
}) {
  const changed = plan.matched.filter((m) => m.diff !== BigInt(0)).length;
  const tiles = [
    { label: "Matched", value: plan.matched.length, sub: countsAllowed ? `${changed} with a different balance` : "balances not this month" },
    { label: "New products", value: plan.added.length, sub: "added with the file's balance" },
    { label: "Not in file", value: plan.notInFile.length, sub: archiveMode === "keep" ? "kept as they are" : `${toArchive.size} to archive` },
    { label: "Need review", value: plan.problems.length, sub: "not applied", warn: plan.problems.length > 0 },
  ];
  return (
    <div className="mt-5 space-y-4" data-inv-import-preview>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className={cn("rounded-xl border border-border bg-panel/60 px-4 py-3", t.warn && "border-status-warning/40")}>
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-tertiary">{t.label}</p>
            <p className="tnum mt-1.5 text-[1.375rem] font-semibold leading-none">{t.value.toLocaleString("en-IN")}</p>
            <p className="mt-1 truncate text-[11.5px] text-text-tertiary">{t.sub}</p>
          </div>
        ))}
      </div>
      {!countsAllowed && (
        <p className="rounded-lg border border-accent/35 bg-accent/[0.06] px-3 py-2 text-[13px] text-text-secondary">
          Balances from a document are recorded as month-start stock counts from {new Date(`${countsFrom}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}.
          Until then only new products (and empty rate / specification) are applied.
        </p>
      )}
      {(repeated > 0 || artefacts > 0) && (
        <p className="text-[12.5px] text-text-tertiary">
          {repeated > 0 && `${repeated} repeated heading row(s) skipped. `}
          {artefacts > 0 && `${artefacts} cell(s) held a spreadsheet leftover such as 1E-13 and were read as their real value (0 or rounded).`}
        </p>
      )}

      <Group title={`Matched (${plan.matched.length})`} open={plan.matched.length > 0 && plan.matched.length <= 20} id="matched">
        <Table
          head={["Serial No", "Description", "Current", "In the file", "Change"]}
          right={[false, false, true, true, true]}
          rows={plan.matched.map((m) => [
            m.product.serial_no + (m.byDescription ? " (by description)" : ""),
            m.product.description,
            m.product.pending ? "Pending" : formatQty(m.product.balance),
            formatQty(m.file),
            m.diff === BigInt(0) ? "same" : `${m.diff > BigInt(0) ? "+" : ""}${formatQty(m.diff)}`,
          ])}
        />
      </Group>

      <Group title={`New products (${plan.added.length})`} open={plan.added.length > 0 && plan.added.length <= 20} id="new">
        <Table
          head={["Serial No", "Description", "Specification", "Rate", "Balance"]}
          right={[false, false, false, true, true]}
          rows={plan.added.map((a) => [a.record.serial, a.record.description, a.record.specification || "—", a.ratePaise === null ? "—" : formatINR(a.ratePaise), formatQty(a.balance)])}
        />
      </Group>

      <Group title={`Not in file (${plan.notInFile.length})`} open={false} id="missing">
        {plan.notInFile.length > 0 && (
          <div className="mb-3 space-y-2 text-[13px]">
            <p className="flex items-start gap-2 text-status-warning">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" /> These active products are not in the file. By default nothing happens to them.
            </p>
            <div className="flex flex-wrap gap-4">
              <label className="inline-flex min-h-11 items-center gap-2 md:min-h-0">
                <input type="radio" name="inv-missing" checked={archiveMode === "keep"} onChange={() => onArchiveMode("keep")} /> Keep as they are
              </label>
              <label className="inline-flex min-h-11 items-center gap-2 md:min-h-0">
                <input type="radio" name="inv-missing" checked={archiveMode === "archive"} onChange={() => onArchiveMode("archive")} data-inv-import-archive /> Archive the ones I tick
              </label>
              {archiveMode === "archive" && (
                <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => onToArchive(toArchive.size === plan.notInFile.length ? new Set() : new Set(plan.notInFile.map((p) => p.id)))}>
                  {toArchive.size === plan.notInFile.length ? "Untick all" : "Tick all"}
                </button>
              )}
            </div>
          </div>
        )}
        <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
          {plan.notInFile.slice(0, 500).map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              {archiveMode === "archive" && (
                <input
                  type="checkbox"
                  aria-label={`Archive ${p.serial_no}`}
                  checked={toArchive.has(p.id)}
                  onChange={() => {
                    const next = new Set(toArchive);
                    if (next.has(p.id)) next.delete(p.id);
                    else next.add(p.id);
                    onToArchive(next);
                  }}
                />
              )}
              <span className="tnum font-medium">{p.serial_no}</span>
              <span className="min-w-0 truncate text-text-secondary">{p.description}</span>
            </li>
          ))}
        </ul>
      </Group>

      <Group title={`Need review (${plan.problems.length})`} open={plan.problems.length > 0 && plan.problems.length <= 30} id="problems" warn={plan.problems.length > 0}>
        <Table head={["Line", "Serial / description", "Why"]} right={[true, false, false]} rows={plan.problems.map((p) => [String(p.line), p.serial, p.reason])} />
      </Group>

      <label className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 text-[13px]">
        <input type="checkbox" className="mt-0.5" checked={fillBlanks} onChange={(e) => onFillBlanks(e.target.checked)} data-inv-import-fill />
        <span>
          <span className="font-medium text-text">Fill empty rate and specification from the file</span>
          <span className="block text-text-tertiary">Only where the product has none. A value already there is never changed.</span>
        </span>
      </label>
    </div>
  );
}

function Group({ title, open, id, children, warn }: { title: string; open: boolean; id: string; children: React.ReactNode; warn?: boolean }) {
  return (
    <details className={cn("group rounded-xl border border-border bg-panel/60", warn && "border-status-warning/40")} open={open} data-inv-import-group={id}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-[14px] font-semibold">
        {title}
        <ChevronDown size={16} className="text-text-tertiary transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="border-t border-border p-3">{children}</div>
    </details>
  );
}

function Table({ head, right, rows }: { head: string[]; right: boolean[]; rows: string[][] }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return <p className="px-1 py-2 text-[13px] text-text-tertiary">None.</p>;
  const shown = all ? rows : rows.slice(0, SHOW);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="text-left text-[11px] uppercase tracking-[0.05em] text-text-tertiary">
            <tr>{head.map((h, i) => <th key={h} className={cn("px-2 py-1.5 font-medium", right[i] && "text-right")}>{h}</th>)}</tr>
          </thead>
          <tbody className="tnum">
            {shown.map((r, k) => (
              <tr key={k} className="border-t border-border">
                {r.map((c, i) => <td key={i} className={cn("max-w-[18rem] break-words px-2 py-1.5", right[i] && "text-right")}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > SHOW && (
        <button type="button" className="mt-2 inline-flex min-h-11 items-center gap-1 px-2 text-[12.5px] font-medium text-accent md:min-h-0" onClick={() => setAll((v) => !v)}>
          <FileText size={13} /> {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </>
  );
}
