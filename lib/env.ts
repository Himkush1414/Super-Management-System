/**
 * Fail fast with a clear message when a required env var is missing, instead
 * of letting `undefined` reach @supabase/ssr and surface as an opaque
 * "Invalid URL" or fetch error several layers down.
 *
 * Callers must pass the value via a *static* `process.env.NEXT_PUBLIC_*`
 * expression (not a dynamic lookup) so Next.js can still inline it into the
 * browser bundle where this runs client-side.
 */
export function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in .env.local (see .env.example).`,
    );
  }
  return value;
}
