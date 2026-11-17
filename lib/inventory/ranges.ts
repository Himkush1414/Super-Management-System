/**
 * lib/inventory/ranges.ts — the export ranges (IST calendar days) and the
 * export file name. Shared by the export dialog (browser) and the export
 * route (server) so both always agree.
 *
 * No imports: node --test loads it.
 */

export type RangeKind = "week" | "month" | "prev_month" | "all" | "custom";

export const RANGE_LABELS: Record<RangeKind, string> = {
  week: "This week",
  month: "This month",
  prev_month: "Previous month",
  all: "All",
  custom: "Custom",
};

export type ResolvedRange = { from: string; to: string; label: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const toUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);

export function isIsoDay(value: string | null | undefined): value is string {
  if (!value || !ISO.test(value)) return false;
  const d = toUtc(value);
  return !Number.isNaN(d.getTime()) && fromUtc(d) === value;
}

export function addDays(iso: string, n: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

/** "2026-11-17" -> "17-11-2026" */
export const dmyDash = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
/** "2026-11-17" -> "17/11/2026" */
export const dmySlash = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * The [from, to] days of a range, today being `today` (IST). Weeks run
 * Monday–Sunday; "this week" / "this month" end today (nothing later can
 * exist). "All" starts at `earliest` (the first month with stock). A custom
 * range must have from ≤ to, and to is capped at today. Returns null when
 * the range is invalid.
 */
export function resolveRange(
  kind: RangeKind,
  today: string,
  opts: { from?: string | null; to?: string | null; earliest?: string | null } = {},
): ResolvedRange | null {
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (kind) {
    case "week": {
      const dow = (toUtc(today).getUTCDay() + 6) % 7; // Monday = 0
      return { from: addDays(today, -dow), to: today, label: RANGE_LABELS.week };
    }
    case "month":
      return { from: monthStart, to: today, label: RANGE_LABELS.month };
    case "prev_month": {
      const to = addDays(monthStart, -1);
      return { from: `${to.slice(0, 7)}-01`, to, label: RANGE_LABELS.prev_month };
    }
    case "all": {
      const from = isIsoDay(opts.earliest) && opts.earliest < today ? opts.earliest : monthStart;
      return { from, to: today, label: RANGE_LABELS.all };
    }
    case "custom": {
      if (!isIsoDay(opts.from) || !isIsoDay(opts.to)) return null;
      const to = opts.to > today ? today : opts.to;
      if (opts.from > to) return null;
      return { from: opts.from, to, label: RANGE_LABELS.custom };
    }
    default:
      return null;
  }
}

/** "NR Industries Product Specification 01-11-2026 to 17-11-2026.pdf" */
export function exportFileName(from: string, to: string, ext: "pdf" | "docx"): string {
  return `NR Industries Product Specification ${dmyDash(from)} to ${dmyDash(to)}.${ext}`;
}
