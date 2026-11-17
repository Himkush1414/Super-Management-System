"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, ArrowRight, RotateCcw, Pencil, Archive, ArchiveRestore, History } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { checkQty, formatQty, parseQty, qtyToText } from "@/lib/inventory/numbers";
import { entryFingerprint, isEntryDateAllowed, monthOf, nextKey } from "@/lib/inventory/ledger";
import { istToday } from "@/lib/inventory/ranges";
import { recordEntry, reverseEntry, setProductActive, updateProduct } from "@/lib/inventory/actions";
import type { InvColumn, InvHistory, InvHistoryEntry } from "@/lib/inventory/types";
import { cn, formatDateTime, formatDay } from "@/lib/utils";
import { DayField, Field, FieldLabel, newKey, qty } from "./bits";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { customText, monthLabel, type Row } from "./model";
import { invalidateHistory, loadHistory } from "./stores";

export type PanelProps = {
  row: Row;
  customCols: InvColumn[];
  formCols: InvColumn[];
  canManage: boolean;
  /** viewing the current month (entries allowed) */
  isCurrent: boolean;
  today: string;
  /** the server confirmed an entry (ledger id `seq`): show the new figures at once */
  onRecorded: (e: { productId: string; kind: "receive" | "issue"; qty: string; balanceAfter?: string; reversal?: boolean; seq?: number; date: string }) => void;
};

/** Today in India on this device, never before the server's today (a clock running behind). */
function deviceToday(serverToday: string): string {
  const t = istToday();
  return t < serverToday ? serverToday : t;
}

export function ProductPanel({ row, customCols, formCols, canManage, isCurrent, today, onRecorded }: PanelProps) {
  const [history, setHistory] = useState<InvHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const writable = canManage && isCurrent && row.is_active;
  // only the newest request may set the list (an older answer arriving late is dropped)
  const ticket = useRef(0);

  const refreshHistory = useCallback((fresh?: boolean) => {
    const my = ++ticket.current;
    if (fresh) invalidateHistory(row.id);
    loadHistory(row.id).then(
      (h) => {
        if (my !== ticket.current) return;
        setHistory(h);
        setHistoryError(null);
      },
      (e: unknown) => {
        if (my !== ticket.current) return;
        setHistoryError(e instanceof Error ? e.message : "The history didn't load. Please try again.");
      },
    );
  }, [row.id]);

  useEffect(() => {
    refreshHistory();
    const t = ticket;
    return () => {
      t.current++; // closed: ignore anything still on its way
    };
  }, [refreshHistory]);

  return (
    <div className="border-t border-border px-4 pb-5 pt-4 md:px-5">
      <div className={cn("grid gap-5", writable ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" : "")}>
        {writable && (
          <EntryForm row={row} today={today} onSaved={(e) => {
            onRecorded({ productId: row.id, ...e });
            refreshHistory(true);
          }} />
        )}
        <div className="min-w-0">
          <HistoryList
            history={history}
            error={historyError}
            onRetry={() => refreshHistory(true)}
            row={row}
            canReverse={writable}
            today={today}
            onReversed={(e, after, seq) => {
              onRecorded({ productId: row.id, kind: e.kind, qty: e.qty, balanceAfter: after, reversal: true, seq, date: deviceToday(today) });
              refreshHistory(true);
            }}
          />
        </div>
      </div>

      {(customCols.length > 0 || canManage) && (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {formCols.filter((c) => !c.visible && customText(row, c)).map((c) => (
            <span key={c.id} className="text-[12px] text-text-tertiary">
              {c.label}: <span className="text-text-secondary">{customText(row, c)}</span>
            </span>
          ))}
          {canManage && isCurrent && <ProductActions row={row} formCols={formCols} />}
        </div>
      )}
    </div>
  );
}

// ── receive / issue ─────────────────────────────────────────────────────

function EntryForm({
  row,
  today,
  onSaved,
}: {
  row: Row;
  today: string;
  onSaved: (e: { kind: "receive" | "issue"; qty: string; balanceAfter?: string; seq?: number; date: string }) => void;
}) {
  const uid = useId();
  const toast = useToast();
  const [kind, setKind] = useState<"receive" | "issue">("receive");
  const [qtyText, setQtyText] = useState("");
  const [date, setDate] = useState(() => deviceToday(today));
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // One key per entry: a double tap or a retried request records once. If
  // anything in the entry changes after an attempt, it gets a new key, so a
  // changed entry can never come back as "already saved" for the old one.
  const attempt = useRef<{ key: string; fp: string } | null>(null);
  const savingRef = useRef(false);
  const dayNow = deviceToday(today);

  const q = checkQty(qtyText);
  const after = q.ok ? (kind === "receive" ? row.b + q.qty : row.b - q.qty) : null;
  const dateOk = isEntryDateAllowed(date, dayNow);
  const overIssue = kind === "issue" && q.ok && q.qty > row.b;
  const qtyError = touched && qtyText.trim() !== "" && !q.ok ? q.message : overIssue ? `Only ${formatQty(row.b)} in stock.` : null;
  const dateError = touched && !dateOk ? "Choose a date in this month, not after today." : null;
  const canReview = q.ok && dateOk && !overIssue;

  function reset() {
    setQtyText("");
    setNote("");
    setDate(deviceToday(today));
    setTouched(false);
    attempt.current = null;
  }

  async function confirm() {
    // synchronous guard: a second tap in the same frame never sends twice
    if (!q.ok || savingRef.current) return;
    savingRef.current = true;
    const qtyNorm = qtyToText(q.qty);
    attempt.current = nextKey(attempt.current, entryFingerprint(row.id, kind, qtyNorm, date, note), newKey);
    setSaving(true);
    setServerError(null);
    try {
      const res = await recordEntry({ productId: row.id, kind, qty: qtyText, date, note, key: attempt.current.key });
      if (res.ok) {
        setConfirming(false);
        onSaved({ kind, qty: qtyNorm, balanceAfter: res.balanceAfter, seq: typeof res.id === "number" ? res.id : Number(res.id), date });
        toast("success", `${kind === "receive" ? "Received" : "Issued"} ${formatQty(q.qty)} · ${row.serial_no}. Balance ${qty(res.balanceAfter ?? null)}.`);
        reset();
      } else {
        setServerError(res.error);
      }
    } catch {
      setServerError("No answer from the server. Check the connection, then confirm again: it won't be saved twice.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (canReview) setConfirming(true);
      }}
      className="rounded-xl border border-border bg-bg-subtle/60 p-4"
      aria-labelledby={`${uid}-h`}
    >
      <h3 id={`${uid}-h`} className="sr-only">
        Record stock for {row.serial_no}
      </h3>
      <div role="radiogroup" aria-label="Entry type" className="grid grid-cols-2 gap-1 rounded-xl bg-overlay/[0.05] p-1">
        {(["receive", "issue"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              "nr-interactive inline-flex h-11 items-center justify-center gap-2 rounded-lg text-[14px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 md:h-10",
              kind === k
                ? k === "receive"
                  ? "bg-panel text-status-success shadow-[0_1px_0_rgba(255,255,255,0.04),0_2px_8px_-2px_rgba(0,0,0,0.4)] ring-1 ring-status-success/30"
                  : "bg-panel text-status-info shadow-[0_1px_0_rgba(255,255,255,0.04),0_2px_8px_-2px_rgba(0,0,0,0.4)] ring-1 ring-status-info/30"
                : "text-text-secondary hover:text-text",
            )}
          >
            {k === "receive" ? <ArrowDownToLine size={15} /> : <ArrowUpFromLine size={15} />}
            {k === "receive" ? "Receive" : "Issue"}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor={`${uid}-q`} hint={`In stock: ${formatQty(row.b)}`}>
            Quantity
          </FieldLabel>
          <Field
            id={`${uid}-q`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={Boolean(qtyError)}
            aria-describedby={qtyError ? `${uid}-qe` : undefined}
            className="tnum text-[17px] font-semibold md:text-[15px]"
          />
          {qtyError && (
            <p id={`${uid}-qe`} className="mt-1.5 text-[12.5px] text-status-danger">
              {qtyError}
            </p>
          )}
        </div>
        <div>
          <FieldLabel htmlFor={`${uid}-d`}>Date</FieldLabel>
          <DayField
            id={`${uid}-d`}
            value={date}
            onChange={setDate}
            min={monthOf(dayNow)}
            max={dayNow}
            describedBy={dateError ? `${uid}-de` : undefined}
          />
          {dateError && (
            <p id={`${uid}-de`} className="mt-1.5 text-[12.5px] text-status-danger">
              {dateError}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3">
        <FieldLabel htmlFor={`${uid}-n`} hint="Optional">
          Note
        </FieldLabel>
        <Field
          id={`${uid}-n`}
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
          placeholder={kind === "receive" ? "Supplier, challan no…" : "Issued to, job / order…"}
        />
      </div>

      {after !== null && !overIssue && (
        <p className="tnum mt-3 flex flex-wrap items-center gap-1.5 text-[13px] text-text-secondary">
          Balance <span className="font-medium text-text">{formatQty(row.b)}</span>
          <ArrowRight size={13} className="text-text-tertiary" />
          <span className={cn("font-semibold", kind === "receive" ? "text-status-success" : "text-status-info")}>{formatQty(after)}</span>
          <span className="text-text-tertiary">after you confirm</span>
        </p>
      )}

      <Button type="submit" size="lg" className="mt-4 h-11 w-full" disabled={touched && !canReview}>
        Review {kind === "receive" ? "receipt" : "issue"}
      </Button>

      <Sheet
        open={confirming}
        onClose={() => !saving && setConfirming(false)}
        busy={saving}
        title={kind === "receive" ? "Confirm receipt" : "Confirm issue"}
        description={
          <>
            <span className="font-medium text-text">{row.serial_no}</span> · {row.description}
            {row.specification ? ` · ${row.specification}` : ""}
          </>
        }
      >
        {q.ok && after !== null && (
          <div className="space-y-4">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl border border-border bg-bg-subtle px-4 py-4 text-center">
              <div>
                <p className="text-[11px] uppercase tracking-[0.06em] text-text-tertiary">Balance now</p>
                <p className="tnum mt-1 text-[22px] font-semibold leading-none">{formatQty(row.b)}</p>
              </div>
              <div className={cn("tnum rounded-full px-2.5 py-1 text-[13px] font-semibold", kind === "receive" ? "bg-status-success/12 text-status-success" : "bg-status-info/12 text-status-info")}>
                {kind === "receive" ? "+" : "−"}
                {formatQty(q.qty)}
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.06em] text-text-tertiary">After</p>
                <p className="tnum mt-1 text-[22px] font-semibold leading-none">{formatQty(after)}</p>
              </div>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
              <dt className="text-text-tertiary">Date</dt>
              <dd className="tnum">{formatDay(date)}</dd>
              {note.trim() && (
                <>
                  <dt className="text-text-tertiary">Note</dt>
                  <dd className="break-words">{note.trim()}</dd>
                </>
              )}
            </dl>
            {serverError && (
              <p role="alert" className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-[13px] text-status-danger">
                {serverError}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" size="lg" className="h-11" onClick={() => setConfirming(false)} disabled={saving}>
                Back
              </Button>
              <Button type="button" size="lg" className="h-11" onClick={confirm} loading={saving} data-autofocus>
                {saving ? "Saving…" : kind === "receive" ? "Confirm receipt" : "Confirm issue"}
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </form>
  );
}

// ── history ─────────────────────────────────────────────────────────────

function HistoryList({
  history,
  error,
  onRetry,
  row,
  canReverse,
  today,
  onReversed,
}: {
  history: InvHistory | null;
  error: string | null;
  onRetry: () => void;
  row: Row;
  canReverse: boolean;
  today: string;
  onReversed: (e: InvHistoryEntry, balanceAfter: string | undefined, seq: number | undefined) => void;
}) {
  const [reversing, setReversing] = useState<InvHistoryEntry | null>(null);
  const byId = new Map((history?.entries ?? []).map((e) => [e.id, e]));

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
          <History size={14} className="text-text-tertiary" /> Recent history
        </h3>
        {history && history.entries.length > 0 && (
          <span className="text-[12px] text-text-tertiary">Last {history.entries.length}</span>
        )}
      </div>

      {error ? (
        <div className="rounded-lg border border-border px-3 py-3 text-[13px] text-text-secondary">
          {error}{" "}
          <button type="button" onClick={onRetry} className="font-medium text-accent underline-offset-2 hover:underline">
            Try again
          </button>
        </div>
      ) : !history ? (
        <ul aria-busy="true" aria-label="Loading history" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-12 animate-pulse rounded-lg bg-overlay/[0.04] motion-reduce:animate-none" />
          ))}
        </ul>
      ) : history.entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong px-3 py-4 text-center text-[13px] text-text-secondary">
          No entries yet. Opening balance {qty(row.opening)}.
        </p>
      ) : (
        <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {history.entries.map((e) => {
            const plus = Number(e.delta) > 0;
            const reversed = e.reversed_by !== null;
            const orig = e.reverses_id ? byId.get(e.reverses_id) : undefined;
            return (
              <li key={e.id} className={cn("flex items-start gap-3 px-3 py-2.5", reversed && "opacity-60")}>
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full",
                    e.reverses_id ? "bg-status-warning/12 text-status-warning" : e.kind === "receive" ? "bg-status-success/12 text-status-success" : "bg-status-info/12 text-status-info",
                  )}
                >
                  {e.reverses_id ? <RotateCcw size={13} /> : e.kind === "receive" ? <ArrowDownToLine size={13} /> : <ArrowUpFromLine size={13} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                    <span className="font-medium">
                      {e.reverses_id ? `Reversal of #${e.reverses_id}` : e.kind === "receive" ? "Received" : "Issued"}
                    </span>
                    <span className={cn("tnum font-semibold", plus ? "text-status-success" : "text-status-info")}>
                      {plus ? "+" : "−"}
                      {qty(e.qty)}
                    </span>
                    {reversed && <span className="text-[11.5px] text-status-warning">Reversed by #{e.reversed_by}</span>}
                  </p>
                  <p className="mt-0.5 text-[12px] text-text-tertiary">
                    <span className="tnum">#{e.id} · {formatDay(e.entry_date)}</span>
                    {e.source === "import" ? " · Imported" : e.by ? ` · ${e.by}` : ""}
                    {orig ? ` · ${orig.kind === "receive" ? "receipt" : "issue"} of ${qty(orig.qty)}` : ""}
                  </p>
                  {e.note && <p className="mt-0.5 break-words text-[12.5px] text-text-secondary">{e.note}</p>}
                </div>
                {canReverse && e.reversible && (
                  <button
                    type="button"
                    onClick={() => setReversing(e)}
                    className="nr-interactive inline-flex h-11 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-medium text-text-secondary hover:bg-overlay/[0.06] hover:text-text md:h-8"
                  >
                    <RotateCcw size={13} /> Reverse
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {history && history.months.length > 0 && (
        <details className="group mt-3 rounded-lg border border-border">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-[13px] font-medium text-text-secondary hover:text-text md:min-h-9">
            Closed months
          </summary>
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-[12.5px]">
              <thead className="text-left text-[11px] uppercase tracking-[0.05em] text-text-tertiary">
                <tr>
                  <th className="px-3 py-2 font-medium">Month</th>
                  <th className="px-3 py-2 text-right font-medium">Opening</th>
                  <th className="px-3 py-2 text-right font-medium">Received</th>
                  <th className="px-3 py-2 text-right font-medium">Issued</th>
                  <th className="px-3 py-2 text-right font-medium">Closing</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {history.months.map((m) => (
                  <tr key={m.month} className="border-t border-border">
                    <td className="px-3 py-2">{monthLabel(m.month)}</td>
                    <td className="px-3 py-2 text-right">{qty(m.opening)}</td>
                    <td className="px-3 py-2 text-right">{qty(m.received)}</td>
                    <td className="px-3 py-2 text-right">{qty(m.issued)}</td>
                    <td className="px-3 py-2 text-right font-medium">{qty(m.closing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {reversing && (
        <ReverseSheet entry={reversing} row={row} today={today} onClose={() => setReversing(null)} onDone={(after, seq) => {
          onReversed(reversing, after, seq);
          setReversing(null);
        }} />
      )}
    </div>
  );
}

function ReverseSheet({
  entry,
  row,
  onClose,
  onDone,
}: {
  entry: InvHistoryEntry;
  row: Row;
  today: string;
  onClose: () => void;
  onDone: (balanceAfter: string | undefined, seq: number | undefined) => void;
}) {
  const uid = useId();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newKey);
  const savingRef = useRef(false);
  const d = parseQty(entry.delta) ?? BigInt(0);
  const after = row.b - d;
  const blocked = after < BigInt(0);

  async function go() {
    if (savingRef.current || blocked) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await reverseEntry({ entryId: entry.id, note, key });
      if (res.ok) {
        toast("success", `Entry #${entry.id} reversed. Balance ${qty(res.balanceAfter ?? null)}.`);
        onDone(res.balanceAfter, typeof res.id === "number" ? res.id : Number(res.id));
      } else setError(res.error);
    } catch {
      setError("No answer from the server. Check the connection, then try again: it won't be reversed twice.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Sheet open onClose={onClose} busy={saving} title={`Reverse entry #${entry.id}`} description="A new opposite entry is added. The original stays in the history.">
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl border border-border bg-bg-subtle px-4 py-4 text-center">
          <div>
            <p className="text-[11px] uppercase tracking-[0.06em] text-text-tertiary">Balance now</p>
            <p className="tnum mt-1 text-[22px] font-semibold leading-none">{formatQty(row.b)}</p>
          </div>
          <ArrowRight size={16} className="text-text-tertiary" />
          <div>
            <p className="text-[11px] uppercase tracking-[0.06em] text-text-tertiary">After</p>
            <p className={cn("tnum mt-1 text-[22px] font-semibold leading-none", blocked && "text-status-danger")}>{formatQty(after)}</p>
          </div>
        </div>
        <p className="text-[13px] text-text-secondary">
          Undo the {entry.kind === "receive" ? "receipt" : "issue"} of <span className="tnum font-medium text-text">{qty(entry.qty)}</span> dated{" "}
          <span className="tnum">{formatDay(entry.entry_date)}</span> ({formatDateTime(entry.created_at)}).
        </p>
        {blocked && (
          <p role="alert" className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-[13px] text-status-danger">
            Not possible: the balance would go below zero.
          </p>
        )}
        <div>
          <FieldLabel htmlFor={`${uid}-n`} hint="Optional">
            Reason
          </FieldLabel>
          <Field id={`${uid}-n`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Typed the wrong quantity…" />
        </div>
        {error && (
          <p role="alert" className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-[13px] text-status-danger">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" size="lg" className="h-11" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" size="lg" className="h-11" onClick={go} loading={saving} disabled={blocked}>
            {saving ? "Reversing…" : "Reverse entry"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

// ── edit details / archive ──────────────────────────────────────────────

function ProductActions({ row, formCols }: { row: Row; formCols: InvColumn[] }) {
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  return (
    <div className="ml-auto flex flex-wrap gap-2">
      {row.is_active && (
        <Button type="button" variant="secondary" className="h-11 md:h-9" onClick={() => setEditing(true)}>
          <Pencil size={14} /> Edit details
        </Button>
      )}
      <Button type="button" variant={row.is_active ? "danger" : "secondary"} className="h-11 md:h-9" onClick={() => setArchiving(true)}>
        {row.is_active ? <Archive size={14} /> : <ArchiveRestore size={14} />}
        {row.is_active ? "Archive" : "Restore"}
      </Button>
      {editing && <EditSheet row={row} formCols={formCols} onClose={() => setEditing(false)} />}
      {archiving && <ArchiveSheet row={row} onClose={() => setArchiving(false)} />}
    </div>
  );
}

function EditSheet({ row, formCols, onClose }: { row: Row; formCols: InvColumn[]; onClose: () => void }) {
  const uid = useId();
  const toast = useToast();
  const [description, setDescription] = useState(row.description);
  const [specification, setSpecification] = useState(row.specification);
  const [rate, setRate] = useState(row.rate ?? "");
  const [custom, setCustom] = useState<Record<string, string>>(() => ({ ...row.custom }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      // the action re-renders the page in the same response (no second request)
      const res = await updateProduct({ productId: row.id, description, specification, rate, custom });
      if (res.ok) {
        toast("success", `${row.serial_no}: details saved.`);
        onClose();
      } else setError(res.error);
    } catch {
      setError("No answer from the server. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Sheet open onClose={onClose} busy={saving} wide title={`Edit ${row.serial_no}`} description="The serial number and opening balance never change.">
      <form onSubmit={save} className="space-y-3">
        <div>
          <FieldLabel htmlFor={`${uid}-d`}>Material description</FieldLabel>
          <Field id={`${uid}-d`} required maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor={`${uid}-s`}>Specification</FieldLabel>
            <Field id={`${uid}-s`} maxLength={300} value={specification} onChange={(e) => setSpecification(e.target.value)} />
          </div>
          <div>
            <FieldLabel htmlFor={`${uid}-r`} hint="₹ per unit">
              Rate
            </FieldLabel>
            <Field id={`${uid}-r`} inputMode="decimal" className="tnum" value={rate} onChange={(e) => setRate(e.target.value)} />
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
          <Button type="submit" size="lg" className="h-11" loading={saving}>
            {saving ? "Saving…" : "Save details"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function ArchiveSheet({ row, onClose }: { row: Row; onClose: () => void }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const archive = row.is_active;

  async function go() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      // the action re-renders the page in the same response (no second request)
      const res = await setProductActive(row.id, !archive);
      if (res.ok) {
        toast("success", `${row.serial_no} ${archive ? "archived" : "restored"}.`);
        onClose();
      } else setError(res.error);
    } catch {
      setError("No answer from the server. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      busy={saving}
      title={archive ? `Archive ${row.serial_no}?` : `Restore ${row.serial_no}?`}
      description={row.description}
    >
      <div className="space-y-4 text-[13px] text-text-secondary">
        {archive ? (
          <>
            <p>It leaves the list and takes no new entries. Nothing is deleted: its history and month records stay, and you can restore it any time from “Archived”.</p>
            {row.b !== BigInt(0) && (
              <p className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-status-warning">
                It still has a balance of <span className="tnum font-semibold">{formatQty(row.b)}</span>.
              </p>
            )}
          </>
        ) : (
          <p>It comes back to the list with its history, and takes entries again.</p>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-status-danger">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" size="lg" className="h-11" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" variant={archive ? "destructive" : "primary"} size="lg" className="h-11" onClick={go} loading={saving}>
            {archive ? "Archive product" : "Restore product"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/** Inputs for the custom columns, typed (text / number / date). */
export function CustomInputs({
  cols,
  values,
  onChange,
  idPrefix,
}: {
  cols: InvColumn[];
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  idPrefix: string;
}) {
  if (!cols.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cols.map((c) => (
        <div key={c.id}>
          <FieldLabel htmlFor={`${idPrefix}-c-${c.id}`} hint={c.visible ? undefined : "Hidden column"}>
            {c.label}
          </FieldLabel>
          {c.data_type === "date" ? (
            <DayField id={`${idPrefix}-c-${c.id}`} value={values[c.id] ?? ""} onChange={(iso) => onChange({ ...values, [c.id]: iso })} />
          ) : (
            <Field
              id={`${idPrefix}-c-${c.id}`}
              inputMode={c.data_type === "number" ? "decimal" : undefined}
              className={c.data_type === "number" ? "tnum" : undefined}
              maxLength={200}
              value={values[c.id] ?? ""}
              onChange={(e) => onChange({ ...values, [c.id]: e.target.value })}
            />
          )}
        </div>
      ))}
    </div>
  );
}
