/**
 * Calendar periods for the bulk orders PDF — weeks (Monday–Sunday), months,
 * years — all in IST, by the order's DISPATCH date. Pure functions shared by
 * the period picker (client) and the PDF route (server), so both always
 * agree on what "this week" contains.
 */

export type PeriodKind = "week" | "month" | "year" | "all";

export type Period = {
  kind: PeriodKind;
  /** first day, YYYY-MM-DD (null for "all") */
  start: string | null;
  /** day AFTER the last day, YYYY-MM-DD (null for "all") */
  end: string | null;
  label: string;
};

const TZ = "Asia/Kolkata";
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** A timestamp's calendar date in IST, YYYY-MM-DD. */
export function istDay(ts: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(ts));
}

const toUtc = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
};
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** The period of `kind` that contains the date `at` (YYYY-MM-DD). */
export function periodContaining(kind: PeriodKind, at: string): Period {
  if (kind === "all") return { kind, start: null, end: null, label: "All time" };
  const [y, m] = at.split("-").map(Number);
  if (kind === "year") {
    return { kind, start: `${y}-01-01`, end: `${y + 1}-01-01`, label: String(y) };
  }
  if (kind === "month") {
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    return { kind, start, end: next, label: `${MONTHS[m - 1]} ${y}` };
  }
  const dow = (toUtc(at).getUTCDay() + 6) % 7; // Monday = 0
  const start = addDays(at, -dow);
  const end = addDays(start, 7);
  return { kind, start, end, label: `Week ${dmy(start)} – ${dmy(addDays(end, -1))}` };
}

/** UTC instants bounding the period, for filtering created_at. */
export function periodBounds(p: Period): { from: string; to: string } | null {
  if (!p.start || !p.end) return null;
  return { from: `${p.start}T00:00:00+05:30`, to: `${p.end}T00:00:00+05:30` };
}

/**
 * Every period of `kind` that contains at least one of `timestamps`, newest
 * first, with how many fall in each — for the "pick an earlier period" list.
 */
export function periodsWithOrders(kind: Exclude<PeriodKind, "all">, timestamps: string[]) {
  const counts = new Map<string, { period: Period; count: number }>();
  for (const ts of timestamps) {
    const p = periodContaining(kind, istDay(ts));
    const key = p.start!;
    const cur = counts.get(key);
    if (cur) cur.count++;
    else counts.set(key, { period: p, count: 1 });
  }
  return [...counts.values()].sort((a, b) => (a.period.start! < b.period.start! ? 1 : -1));
}

/** How the bulk PDF splits a period into sections. */
export function groupingFor(kind: PeriodKind): { kind: "day" | "week" | "month"; label: (ts: string) => [string, string] } {
  const sub: "day" | "week" | "month" = kind === "week" ? "day" : kind === "month" ? "week" : "month";
  return {
    kind: sub,
    // [sort key, heading]
    label: (ts) => {
      const day = istDay(ts);
      if (sub === "day") return [day, dmy(day)];
      const p = periodContaining(sub, day);
      return [p.start!, p.label];
    },
  };
}
