import { NextResponse } from "next/server";

/** Liveness probe for hosting platforms and the Android app. No auth, no DB call. */
export function GET() {
  return NextResponse.json(
    { ok: true, timestamp: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
