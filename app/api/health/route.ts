import { NextResponse, type NextRequest } from "next/server";
import { instanceInfo } from "@/lib/perf";

/**
 * Liveness probe for hosting platforms / load balancers. No auth, no DB call.
 *
 * `?probe=1` (temporary, performance investigation): times, from inside this
 * function, three sequential calls each to the Supabase Auth health endpoint
 * and to PostgREST (an anon HEAD that RLS answers with zero rows — no data).
 */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("probe") !== "1") {
    return NextResponse.json({ ok: true, timestamp: new Date().toISOString() });
  }
  const inst = instanceInfo();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const time = async (u: string, method = "GET") => {
    const s = performance.now();
    const r = await fetch(u, { method, headers, cache: "no-store" });
    await r.arrayBuffer();
    return { ms: Math.round(performance.now() - s), status: r.status };
  };
  const auth = [], rest = [];
  for (let i = 0; i < 3; i++) auth.push(await time(`${url}/auth/v1/health`));
  for (let i = 0; i < 3; i++) rest.push(await time(`${url}/rest/v1/profiles?select=id&limit=1`, "HEAD"));
  return NextResponse.json({ inst, auth, rest }, { headers: { "Cache-Control": "no-store" } });
}
