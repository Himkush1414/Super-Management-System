"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requireEnv } from "@/lib/env";

/**
 * Browser-side Supabase client. Safe to call in Client Components.
 * Left untyped by generic; query results are cast to types/database.types.ts
 * at each call site until `supabase gen types` is wired up.
 */
export function createClient() {
  return createBrowserClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}
