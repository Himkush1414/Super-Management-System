import { NextResponse } from "next/server";

/** Liveness probe for hosting platforms / load balancers. No auth, no DB call. */
export async function GET() {
  return NextResponse.json({ ok: true, timestamp: new Date().toISOString() });
}
