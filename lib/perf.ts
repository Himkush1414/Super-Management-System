import "server-only";

/**
 * Temporary request timing (performance investigation, 2026-10-07).
 * Prints one JSON line per measured operation to the function log:
 *   {"perf":"session","total_ms":412,"steps":{"getUser":398,...},"inst":{...}}
 * `inst` tells a cold instance (n = 1) from a warm one. No data, no user ids.
 */
const BOOT = Date.now();
let n = 0;

export function instanceInfo() {
  n += 1;
  return { n, age_s: Math.round((Date.now() - BOOT) / 1000), region: process.env.VERCEL_REGION ?? "local" };
}

export function perf(name: string) {
  const t0 = performance.now();
  const steps: Record<string, number> = {};
  return {
    /** time one awaited call (several may run in parallel) */
    async time<T>(label: string, p: PromiseLike<T>): Promise<T> {
      const s = performance.now();
      try {
        return await p;
      } finally {
        steps[label] = Math.round(performance.now() - s);
      }
    },
    end(extra?: Record<string, unknown>) {
      console.log(
        JSON.stringify({ perf: name, total_ms: Math.round(performance.now() - t0), steps, inst: instanceInfo(), ...extra }),
      );
    },
  };
}
