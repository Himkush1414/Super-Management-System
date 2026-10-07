import type { Role } from "@/lib/permissions";

type Named = { full_name: string; real_name?: string | null; role?: Role | string | null };

/**
 * How an account is shown as an actor anywhere (pages, PDFs, CSV, audit).
 * Marketing / production / dispatcher with a real name: "Manik Rana (Production 1)".
 * Everyone else (admin tiers, or before a real name is set): the account's
 * existing label. Mirrors public.display_name() in migration 0016.
 */
export function displayName(p: Named | null | undefined): string {
  if (!p) return "—";
  if ((p.role === "marketing" || p.role === "production" || p.role === "dispatcher") && p.real_name) {
    return `${p.real_name} (${p.full_name})`;
  }
  return p.full_name;
}

/** Real names: letters (any script), spaces, dot, apostrophe, hyphen. */
export function cleanRealName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 80) return null;
  if (!/^[\p{L}][\p{L}\p{M} .'-]*$/u.test(name)) return null;
  return name;
}
