import "server-only";

/**
 * A page read that failed (timed out, network, server error). Thrown so the
 * page shows its error screen with "Try again" (app/dashboard/error.tsx)
 * instead of rendering an empty list, "not found" or the sign-in page as if
 * that were the real answer.
 */
export class ReadError extends Error {
  constructor(what: string, cause?: unknown) {
    super(`Could not load ${what}`);
    this.name = "ReadError";
    // one log line per failed read, no data (Vercel logs)
    const reason =
      cause && typeof cause === "object" && "message" in cause ? String((cause as { message: unknown }).message) : String(cause ?? "");
    console.error(JSON.stringify({ readError: what, reason: reason.slice(0, 200) }));
  }
}

/** The data of a Supabase result, or a ReadError when the read failed. */
export function must<T>(result: { data: T; error: unknown }, what: string): T {
  if (result.error) throw new ReadError(what, result.error);
  return result.data;
}

/** The count of a Supabase head/count result, or a ReadError. */
export function mustCount(result: { count: number | null; error: unknown }, what: string): number {
  if (result.error) throw new ReadError(what, result.error);
  return result.count ?? 0;
}
