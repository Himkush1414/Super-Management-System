"use client";

import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, ArrowRight, RotateCcw, Pencil, Archive, ArchiveRestore, History, TriangleAlert, ChevronDown, ClipboardCheck, Equal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { checkQty, formatQty, isLow, parseQty, qtyToText } from "@/lib/inventory/numbers";
import { entryFingerprint, isEntryDateAllowed, monthOf, nextKey } from "@/lib/inventory/ledger";
import { istToday } from "@/lib/inventory/ranges";
import { recordEntry, recordStockCount, reverseEntry, setProductActive, updateProduct } from "@/lib/inventory/actions";
import type { InvColumn, InvEntryDetails, InvHistory, InvHistoryEntry, InvStockCount } from "@/lib/inventory/types";
import type { EntryDetails } from "@/lib/inventory/actions";
import { cn, formatDateTime, formatDay } from "@/lib/utils";
import { DayField, Field, FieldLabel, newKey, qty } from "./bits";
import { PartyInput } from "./PartyInput";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { customText, monthLabel, type Row } from "./model";
import { invalidateHistory, loadHistory } from "./stores";
import type { CountedEvent } from "./CountList";

export type PanelProps = {
  row: Row;
  customCols: InvColumn[];
  formCols: InvColumn[];
  canManage: boolean;
  /** viewing the current month (entries allowed) */
  isCurrent: boolean;
  today: string;
  /** the server confirmed an entry (ledger id `seq`): show the new figures at once */
  onRecorded: (e: {
    productId: string; kind: "receive" | "issue"; qty: string; balanceAfter?: string; reversal?: boolean; seq?: number; date: string; party?: string | null; belowMin?: boolean;
    count?: { id: number; adjustment: string };
  }) => void;
  /** known party names, for the Party field's suggestions */
  partyNames: string[];
  /** month-start counting applies this month (0031) */
  counting: boolean;
  /** a stock count was saved on its own */
  onCounted: (e: CountedEvent) => void;
};

/** Today in India on this device, never before the server's today (a clock running behind). */
function deviceToday(serverToday: string): string {
  const t = istToday();
  return t < serverToday ? serverToday : t;
}

export function ProductPanel({ row, customCols, formCols, canManage, isCurrent, today, onRecorded, partyNames, counting, onCounted }: PanelProps) {
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
          <EntryForm row={row} today={today} partyNames={partyNames} onSaved={(e) => {
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
            onReversed={(e, after, seq, belowMin) => {
              onRecorded({ productId: row.id, kind: e.kind, qty: e.qty, balanceAfter: after, reversal: true, seq, date: deviceToday(today), belowMin });
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
          {canManage && isCurrent && (
            <ProductActions
              row={row}
              formCols={formCols}
              counting={counting}
              onCounted={(e) => {
                onCounted(e);
                refreshHistory(true);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── receive / issue ─────────────────────────────────────────────────────

type Details = Required<EntryDetails>;
const NO_DETAILS: Details = { party: "", challanNo: "", billNo: "", billDate: "", jobNo: "", rating: "", noOfJobs: "" };
const RECEIVE_KEYS = ["party", "challanNo", "billNo", "billDate"] as const;
const ISSUE_KEYS = ["jobNo", "rating", "noOfJobs"] as const;
const DETAIL_LABEL: Record<keyof Details, string> = {
  party: "Party", challanNo: "Challan No", billNo: "Bill No", billDate: "Bill Date", jobNo: "Job No", rating: "Rating", noOfJobs: "No. of Jobs",
};

/** The details that belong to `kind`, trimmed (others are never sent). */
function detailsFor(kind: "receive" | "issue", d: Details): EntryDetails {
  const keys = kind === "receive" ? RECEIVE_KEYS : ISSUE_KEYS;
  const out: EntryDetails = {};
  for (const k of keys) {
    const v = d[k].replace(/\s+/g, " ").trim();
    if (v) out[k] = v;
  }
  return out;
}

function EntryForm({
  row,
  today,
  partyNames,
  onSaved,
}: {
  row: Row;
  today: string;
  partyNames: string[];
  onSaved: (e: {
    kind: "receive" | "issue"; qty: string; balanceAfter?: string; seq?: number; date: string; party?: string | null; belowMin?: boolean;
    count?: { id: number; adjustment: string };
  }) => void;
}) {
  const uid = useId();
  const toast = useToast();
  const [kind, setKind] = useState<"receive" | "issue">("receive");
  // month-start balance (0031): a pending product is counted first, in the same save.
  // `askCount` also turns on when the server says it's pending (another device's view, a new month)
  const [askCount, setAskCount] = useState(false);
  const needCount = row.pending || askCount;
  const [countText, setCountText] = useState("");
  const countKey = useRef<{ key: string; fp: string } | null>(null);
  const counted = needCount ? parseQty(countText.trim()) : null;
  const countOk = !needCount || (countText.trim() !== "" && counted !== null && counted >= BigInt(0));
  const base = needCount ? (countOk && counted !== null ? counted : null) : row.b;
  const [qtyText, setQtyText] = useState("");
  const [date, setDate] = useState(() => deviceToday(today));
  const [note, setNote] = useState("");
  const [details, setDetails] = useState<Details>(NO_DETAILS);
  const [more, setMore] = useState(false);
  const setD = (k: keyof Details, v: string) => setDetails((d) => ({ ...d, [k]: v }));
  const sent = detailsFor(kind, details);
  const billFuture = kind === "receive" && Boolean(details.billDate) && details.billDate > deviceToday(today);
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
  const after = q.ok && base !== null ? (kind === "receive" ? base + q.qty : base - q.qty) : null;
  const dateOk = isEntryDateAllowed(date, dayNow);
  const overIssue = kind === "issue" && q.ok && base !== null && q.qty > base;
  const qtyError = touched && qtyText.trim() !== "" && !q.ok ? q.message : overIssue ? `Only ${formatQty(base)} in stock.` : null;
  const dateError = touched && !dateOk ? "Choose a date in this month, not after today." : null;
  const countError = touched && needCount && !countOk ? "Enter the balance you counted (0 or more, at most 3 decimals)." : null;
  const adjustment = needCount && counted !== null ? counted - row.b : null;
  const canReview = q.ok && dateOk && !overIssue && !billFuture && countOk && base !== null;
  // an issue that takes the product below its minimum: warned at confirm, never blocked
  const goesLow = kind === "issue" && after !== null && base !== null && isLow(after, row.min) && !isLow(base, row.min);
  const staysLow = kind === "issue" && after !== null && base !== null && isLow(base, row.min);

  function reset() {
    setQtyText("");
    setNote("");
    setDetails(NO_DETAILS);
    setMore(false);
    setDate(deviceToday(today));
    setTouched(false);
    attempt.current = null;
    setCountText("");
    countKey.current = null;
    setAskCount(false);
  }

  async function confirm() {
    // synchronous guard: a second tap in the same frame never sends twice
    if (!q.ok || savingRef.current) return;
    savingRef.current = true;
    const qtyNorm = qtyToText(q.qty);
    const countNorm = needCount && counted !== null ? qtyToText(counted) : null;
    attempt.current = nextKey(attempt.current, entryFingerprint(row.id, kind, qtyNorm, date, `${note}\u0001${JSON.stringify(sent)}\u0001${countNorm ?? ""}`), newKey);
    if (countNorm !== null) countKey.current = nextKey(countKey.current, `${row.id}\u0001${countNorm}\u0001${attempt.current.key}`, newKey);
    setSaving(true);
    setServerError(null);
    try {
      const res = await recordEntry({
        productId: row.id, kind, qty: qtyText, date, note, key: attempt.current.key, details: sent,
        ...(countNorm !== null && countKey.current ? { count: { counted: countNorm, key: countKey.current.key } } : {}),
      });
      if (res.ok) {
        setConfirming(false);
        onSaved({
          kind, qty: qtyNorm, balanceAfter: res.balanceAfter, seq: typeof res.id === "number" ? res.id : Number(res.id), date, party: sent.party ?? null, belowMin: res.belowMin,
          ...(res.countId ? { count: { id: res.countId, adjustment: res.adjustment ?? "0" } } : {}),
        });
        toast("success", `${countNorm !== null ? `Balance ${formatQty(counted)} saved. ` : ""}${kind === "receive" ? "Received" : "Issued"} ${formatQty(q.qty)} · ${row.serial_no}. Balance ${qty(res.balanceAfter ?? null)}.`);
        reset();
      } else if (res.pending) {
        // the server knows it's pending: ask for the count in this same form
        setAskCount(true);
        setConfirming(false);
        setServerError(null);
        toast("error", `${row.serial_no}: enter this month's balance first.`);
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

      {needCount && (
        <div className="mt-4 rounded-lg border border-accent/35 bg-accent/[0.06] p-3" data-inv-count-first>
          <FieldLabel htmlFor={`${uid}-c`} hint={`Opening ${formatQty(row.o)}`}>
            This month&apos;s balance (counted)
          </FieldLabel>
          <div className="flex gap-2">
            <Field
              id={`${uid}-c`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="Counted"
              value={countText}
              onChange={(e) => setCountText(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={Boolean(countError)}
              aria-describedby={countError ? `${uid}-ce` : `${uid}-ch`}
              className="tnum text-[17px] font-semibold md:text-[15px]"
            />
            <Button type="button" variant="secondary" className="h-11 shrink-0 whitespace-nowrap md:h-10" onClick={() => setCountText(qtyToText(row.o))}>
              <Equal size={14} /> Same as opening
            </Button>
          </div>
          {countError ? (
            <p id={`${uid}-ce`} className="mt-1.5 text-[12.5px] text-status-danger">{countError}</p>
          ) : (
            <p id={`${uid}-ch`} className="tnum mt-1.5 text-[12.5px] text-text-secondary">
              {adjustment === null
                ? "Count what is on the shelf first: it is saved with this entry."
                : adjustment === BigInt(0)
                  ? "Same as the opening: no adjustment."
                  : `Adjustment ${adjustment > BigInt(0) ? "+" : ""}${formatQty(adjustment)} (recorded as a stock count).`}
            </p>
          )}
        </div>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor={`${uid}-q`} hint={needCount ? (base === null ? "Count first" : `In stock: ${formatQty(base)}`) : `In stock: ${formatQty(row.b)}`}>
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
      {/* the details: the main one always in view, the rest one tap away (the form stays short on a phone) */}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {kind === "receive" ? (
          <div>
            <FieldLabel htmlFor={`${uid}-party`} hint="Optional">
              Party
            </FieldLabel>
            <PartyInput id={`${uid}-party`} value={details.party} onChange={(v) => setD("party", v)} names={partyNames} placeholder="Supplier name" />
          </div>
        ) : (
          <div>
            <FieldLabel htmlFor={`${uid}-job`} hint="Optional">
              Job No
            </FieldLabel>
            <Field id={`${uid}-job`} value={details.jobNo} maxLength={60} onChange={(e) => setD("jobNo", e.target.value)} />
          </div>
        )}
        <div>
          <FieldLabel htmlFor={`${uid}-n`} hint="Optional">
            Remark
          </FieldLabel>
          <Field id={`${uid}-n`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={kind === "receive" ? "Anything to note" : "Issued to, purpose…"} />
        </div>
      </div>
      <button
        type="button"
        aria-expanded={more}
        onClick={() => setMore((v) => !v)}
        className="nr-interactive mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-[13px] font-medium text-text-secondary hover:text-text md:min-h-9"
      >
        <ChevronDown size={15} className={cn("transition-transform duration-200 motion-reduce:transition-none", more && "rotate-180")} />
        {kind === "receive" ? "Challan, bill no, bill date" : "Rating, no. of jobs"}
        {(() => {
          const n = (kind === "receive" ? (["challanNo", "billNo", "billDate"] as const) : (["rating", "noOfJobs"] as const)).filter((k) => details[k].trim()).length;
          return n ? <span className="rounded-full bg-accent/15 px-1.5 text-[11px] text-accent">{n}</span> : null;
        })()}
      </button>
      {more && (
        <div className="mt-1 grid gap-3 md:grid-cols-2">
          {kind === "receive" ? (
            <>
              <div>
                <FieldLabel htmlFor={`${uid}-ch`}>Challan No</FieldLabel>
                <Field id={`${uid}-ch`} value={details.challanNo} maxLength={60} onChange={(e) => setD("challanNo", e.target.value)} />
              </div>
              <div>
                <FieldLabel htmlFor={`${uid}-bn`}>Bill No</FieldLabel>
                <Field id={`${uid}-bn`} value={details.billNo} maxLength={60} onChange={(e) => setD("billNo", e.target.value)} />
              </div>
              <div>
                <FieldLabel htmlFor={`${uid}-bd`} hint="Not in the future">
                  Bill Date
                </FieldLabel>
                <DayField id={`${uid}-bd`} value={details.billDate} onChange={(v) => setD("billDate", v)} max={dayNow} describedBy={billFuture ? `${uid}-bde` : undefined} />
                {billFuture && (
                  <p id={`${uid}-bde`} className="mt-1.5 text-[12.5px] text-status-danger">
                    The bill date can&apos;t be in the future.
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <div>
                <FieldLabel htmlFor={`${uid}-rt`}>Rating</FieldLabel>
                <Field id={`${uid}-rt`} value={details.rating} maxLength={60} onChange={(e) => setD("rating", e.target.value)} />
              </div>
              <div>
                <FieldLabel htmlFor={`${uid}-nj`}>No. of Jobs</FieldLabel>
                <Field id={`${uid}-nj`} value={details.noOfJobs} maxLength={20} inputMode="numeric" onChange={(e) => setD("noOfJobs", e.target.value)} />
              </div>
            </>
          )}
        </div>
      )}

      {after !== null && !overIssue && base !== null && (
        <p className="tnum mt-3 flex flex-wrap items-center gap-1.5 text-[13px] text-text-secondary">
          Balance <span className="font-medium text-text">{formatQty(base)}</span>
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
        {q.ok && after !== null && base !== null && (
          <div className="space-y-4">
            {needCount && adjustment !== null && (
              <p className="tnum rounded-lg border border-accent/35 bg-accent/[0.06] px-3 py-2 text-[13px] text-text-secondary">
                Month-start balance <span className="font-semibold text-text">{formatQty(base)}</span> (opening {formatQty(row.o)}
                {adjustment === BigInt(0) ? ", no adjustment" : `, adjustment ${adjustment > BigInt(0) ? "+" : ""}${formatQty(adjustment)}`}): saved first, in the same step.
              </p>
            )}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl border border-border bg-bg-subtle px-4 py-4 text-center">
              <div>
                <p className="text-[11px] uppercase tracking-[0.06em] text-text-tertiary">{needCount ? "Counted" : "Balance now"}</p>
                <p className="tnum mt-1 text-[22px] font-semibold leading-none">{formatQty(base)}</p>
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
              {(Object.keys(sent) as (keyof Details)[]).map((k) => (
                <Fragment key={k}>
                  <dt className="text-text-tertiary">{DETAIL_LABEL[k]}</dt>
                  <dd className="break-words">{k === "billDate" ? formatDay(sent[k] ?? "") : sent[k]}</dd>
                </Fragment>
              ))}
              {note.trim() && (
                <>
                  <dt className="text-text-tertiary">Remark</dt>
                  <dd className="break-words">{note.trim()}</dd>
                </>
              )}
            </dl>
            {(goesLow || staysLow) && (
              <p role="status" className="flex items-start gap-2 rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-[13px] text-status-warning">
                <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                <span>
                  {goesLow ? "This takes it below its minimum" : "It is already below its minimum"} ({formatQty(row.min)}): after this, {formatQty(after)} left. Order advised. You can still save.
                </span>
              </p>
            )}
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
  onReversed: (e: InvHistoryEntry, balanceAfter: string | undefined, seq: number | undefined, belowMin?: boolean) => void;
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
      ) : history.entries.length === 0 && !(history.counts?.length) ? (
        <p className="rounded-lg border border-dashed border-border-strong px-3 py-4 text-center text-[13px] text-text-secondary">
          No entries yet. Opening balance {qty(row.opening)}.
        </p>
      ) : (
        <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {merged(history).map((item) => {
            if (item.count) return <CountItem key={`c${item.count.id}`} c={item.count} />;
            const e = item.entry!;
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
                  <EntryDetailsLine d={history.details?.[String(e.id)]} />
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
                  {history.months.some((m) => m.adjustment && Number(m.adjustment) !== 0) && <th className="px-3 py-2 text-right font-medium">Adjustment</th>}
                  <th className="px-3 py-2 text-right font-medium">Received</th>
                  <th className="px-3 py-2 text-right font-medium">Issued</th>
                  <th className="px-3 py-2 text-right font-medium">Closing</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {history.months.map((m) => (
                  <tr key={m.month} className="border-t border-border">
                    <td className="px-3 py-2">
                      {monthLabel(m.month)}
                      {m.confirmed === false && <span className="ml-1.5 text-[11px] text-text-tertiary">(not counted)</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{qty(m.opening)}</td>
                    {history.months.some((x) => x.adjustment && Number(x.adjustment) !== 0) && <td className="px-3 py-2 text-right">{signed(m.adjustment ?? "0")}</td>}
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
        <ReverseSheet entry={reversing} row={row} today={today} onClose={() => setReversing(null)} onDone={(after, seq, belowMin) => {
          onReversed(reversing, after, seq, belowMin);
          setReversing(null);
        }} />
      )}
    </div>
  );
}

/** "+3" / "−2.5" / "0" */
function signed(text: string): string {
  const v = parseQty(text) ?? BigInt(0);
  return `${v > BigInt(0) ? "+" : ""}${formatQty(v)}`;
}

/** Ledger entries and stock counts, newest first (by when they were saved). */
function merged(h: InvHistory): { entry?: InvHistoryEntry; count?: InvStockCount; at: string }[] {
  const out: { entry?: InvHistoryEntry; count?: InvStockCount; at: string }[] = [
    ...h.entries.map((entry) => ({ entry, at: entry.created_at })),
    ...(h.counts ?? []).map((count) => ({ count, at: count.created_at })),
  ];
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** A stock count in the history: "Stock count · counted 10 (−2)". */
function CountItem({ c }: { c: InvStockCount }) {
  const adj = parseQty(c.adjustment) ?? BigInt(0);
  return (
    <li className="flex items-start gap-3 px-3 py-2.5" data-inv-history-count>
      <span aria-hidden className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent">
        <ClipboardCheck size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
          <span className="font-medium">Stock count</span>
          <span className="tnum">counted <span className="font-semibold">{qty(c.counted)}</span></span>
          <span className={cn("tnum font-semibold", adj === BigInt(0) ? "text-text-tertiary" : adj > BigInt(0) ? "text-status-success" : "text-status-info")}>
            {adj === BigInt(0) ? "no adjustment" : signed(c.adjustment)}
          </span>
        </p>
        <p className="mt-0.5 text-[12px] text-text-tertiary">
          <span className="tnum">{formatDay(c.entry_date)}</span>
          {c.entry_date === c.month ? " · month-start balance" : ""}
          {c.source === "import" ? " · from a document" : c.by ? ` · ${c.by}` : ""}
          <span className="tnum"> · before {qty(c.balance_before)}</span>
        </p>
        {c.note && <p className="mt-0.5 break-words text-[12.5px] text-text-secondary">{c.note}</p>}
      </div>
    </li>
  );
}

/** An entry's details in the history: "Party · Challan C1 · Bill B1 · Bill date 16/11/2026" / "Job J1 · Rating R · Jobs 2". */
function EntryDetailsLine({ d }: { d?: InvEntryDetails }) {
  if (!d) return null;
  const bits = [
    d.party,
    d.challan_no && `Challan ${d.challan_no}`,
    d.bill_no && `Bill ${d.bill_no}`,
    d.bill_date && `Bill date ${formatDay(d.bill_date)}`,
    d.job_no && `Job ${d.job_no}`,
    d.rating && `Rating ${d.rating}`,
    d.no_of_jobs && `Jobs ${d.no_of_jobs}`,
  ].filter(Boolean) as string[];
  if (!bits.length) return null;
  return <p className="tnum mt-0.5 break-words text-[12px] text-text-secondary">{bits.join(" · ")}</p>;
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
  onDone: (balanceAfter: string | undefined, seq: number | undefined, belowMin?: boolean) => void;
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
        onDone(res.balanceAfter, typeof res.id === "number" ? res.id : Number(res.id), res.belowMin);
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

function ProductActions({ row, formCols, counting, onCounted }: { row: Row; formCols: InvColumn[]; counting: boolean; onCounted: (e: CountedEvent) => void }) {
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [countingOpen, setCountingOpen] = useState(false);
  return (
    <div className="ml-auto flex flex-wrap gap-2">
      {row.is_active && counting && (
        <Button type="button" variant="secondary" className="h-11 md:h-9" onClick={() => setCountingOpen(true)} data-inv-count-button>
          <ClipboardCheck size={14} /> {row.pending ? "Enter balance" : "Count stock"}
        </Button>
      )}
      {countingOpen && <CountSheet row={row} onClose={() => setCountingOpen(false)} onCounted={onCounted} />}
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

/**
 * Enter a counted balance for one product (0031): a "Stock count" entry
 * with adjustment = counted − the balance now. A product already confirmed
 * this month can be counted again: that adds a new adjustment, nothing is
 * overwritten.
 */
function CountSheet({ row, onClose, onCounted }: { row: Row; onClose: () => void; onCounted: (e: CountedEvent) => void }) {
  const uid = useId();
  const toast = useToast();
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ key: string; fp: string } | null>(null);
  const busy = useRef(false);
  const v = text.trim() ? parseQty(text.trim()) : null;
  const ok = v !== null && v >= BigInt(0);
  const before = row.pending ? row.o : row.b;
  const adj = ok ? v - before : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!ok || busy.current) {
      if (!ok) setError("Enter the balance you counted: 0 or more, at most 3 decimals.");
      return;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    const norm = qtyToText(v);
    attempt.current = nextKey(attempt.current, `${row.id}\u0001${norm}\u0001${note.trim()}`, newKey);
    try {
      const res = await recordStockCount({ productId: row.id, counted: norm, key: attempt.current.key, note });
      if (res.ok) {
        if (res.countId) onCounted({ productId: row.id, countId: res.countId, balanceAfter: res.balanceAfter ?? norm, adjustment: res.adjustment ?? qtyToText(v - before), belowMin: res.belowMin });
        toast("success", `${row.serial_no}: balance ${formatQty(v)} saved.`);
        onClose();
      } else setError(res.error);
    } catch {
      setError("No answer from the server. Check the connection, then save again: it won't be saved twice.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      busy={saving}
      title={row.pending ? `Balance for ${row.serial_no}` : `Count ${row.serial_no} again`}
      description={row.pending ? "Count what is on the shelf at the start of the month." : "The counted balance replaces nothing: a new adjustment is added to the history."}
    >
      <form onSubmit={save} className="space-y-4" noValidate>
        <dl className="tnum grid grid-cols-2 gap-3 rounded-xl border border-border bg-bg-subtle px-4 py-3 text-[13px]">
          <div>
            <dt className="text-[11px] uppercase tracking-[0.06em] text-text-tertiary">Opening</dt>
            <dd className="mt-1 text-[18px] font-semibold">{formatQty(row.o)}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.06em] text-text-tertiary">{row.pending ? "Balance" : "Balance now"}</dt>
            <dd className="mt-1 text-[18px] font-semibold">{row.pending ? "Pending" : formatQty(row.b)}</dd>
          </div>
        </dl>
        <div>
          <FieldLabel htmlFor={`${uid}-v`}>Counted balance</FieldLabel>
          <div className="flex gap-2">
            <Field
              id={`${uid}-v`}
              inputMode="decimal"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
              data-autofocus
              aria-describedby={`${uid}-h`}
              className="tnum text-[17px] font-semibold md:text-[15px]"
            />
            {row.pending && (
              <Button type="button" variant="secondary" className="h-11 shrink-0 whitespace-nowrap md:h-10" onClick={() => setText(qtyToText(row.o))}>
                <Equal size={14} /> Same as opening
              </Button>
            )}
          </div>
          <p id={`${uid}-h`} className="tnum mt-1.5 text-[12.5px] text-text-secondary">
            {adj === null ? "\u00a0" : adj === BigInt(0) ? "No adjustment." : `Adjustment ${adj > BigInt(0) ? "+" : ""}${formatQty(adj)}.`}
          </p>
        </div>
        <div>
          <FieldLabel htmlFor={`${uid}-n`} hint="Optional">
            Remark
          </FieldLabel>
          <Field id={`${uid}-n`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Counted with the supervisor…" />
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
          <Button type="submit" size="lg" className="h-11" loading={saving}>
            {saving ? "Saving…" : "Save balance"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function EditSheet({ row, formCols, onClose }: { row: Row; formCols: InvColumn[]; onClose: () => void }) {
  const uid = useId();
  const toast = useToast();
  const [description, setDescription] = useState(row.description);
  const [specification, setSpecification] = useState(row.specification);
  const [rate, setRate] = useState(row.rate ?? "");
  const [custom, setCustom] = useState<Record<string, string>>(() => ({ ...row.custom }));
  const [min, setMin] = useState(row.minText ?? "");
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
      const res = await updateProduct({ productId: row.id, description, specification, rate, custom, minStock: min });
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
          <div>
            <FieldLabel htmlFor={`${uid}-m`} hint="Alert below this · empty = none">
              Minimum stock
            </FieldLabel>
            <Field id={`${uid}-m`} inputMode="decimal" className="tnum" value={min} onChange={(e) => setMin(e.target.value)} />
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
            <p>It leaves the list and takes no new entries. Nothing is deleted: its history and month records stay, and you can restore it any time from the Archive tab (or “Archived” in the list).</p>
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
