export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** The business runs on Indian time; never format in the server's zone (UTC on Vercel). */
export const TZ = "Asia/Kolkata";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const inrPaise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * "₹7,500" for whole rupees, "₹1,25,000.50" when there are paise — never
 * rounded, so price + GST visibly adds up to the total.
 */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return Number.isInteger(Math.round(value * 100) / 100) ? inr.format(value) : inrPaise.format(value);
}

/** Date and time pieces in IST, 2-digit, independent of the runtime's locale. */
function istParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    dd: get("day"),
    mm: get("month"),
    yyyy: get("year"),
    hh: get("hour").padStart(2, "0"),
    min: get("minute"),
    ampm: get("dayPeriod").toLowerCase(),
  };
}

/*
 * Every date in the system is DD/MM/YYYY (day, month, year), and every time
 * is IST — pages, PDFs and CSV all format through these helpers.
 */

/** A timestamp's date: "05/10/2026". */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const p = istParts(new Date(value));
  return `${p.dd}/${p.mm}/${p.yyyy}`;
}

/** A calendar date stored as YYYY-MM-DD: "15/01/2027" — no timezone shift. */
export function formatDay(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

/** A timestamp with time: "05/10/2026 12:09 pm". */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const p = istParts(new Date(value));
  return `${p.dd}/${p.mm}/${p.yyyy} ${p.hh}:${p.min} ${p.ampm}`;
}

export function formatRelativeTime(value: string): string {
  const then = new Date(value).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(value);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/** The PDF footer stamp: "05/10/2026 12:09 pm" (IST). */
export function formatStamp(d: Date = new Date()): string {
  return formatDateTime(d.toISOString());
}

/** CSV timestamp column: "05/10/2026 12:09" (IST, 24-hour). */
export function formatCsvDateTime(value: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).formatToParts(new Date(value));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour").replace(/^24$/, "00")}:${get("minute")}`;
}

/** "15/01/2027" -> "2027-01-15" if it's a real calendar date, else null. */
export function parseDmy(value: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}
