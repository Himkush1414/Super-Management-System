import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { timedFetch } from "@/lib/supabase/fetch";

const DASHBOARD_PREFIX = "/dashboard";

/** Cap an Auth call so a slow/unreachable Auth server degrades to "signed out". */
function withTimeout<T>(p: Promise<T>, ms = 5000): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch(
    () => null,
  );
}

/**
 * Runs before every matched request (proxy.ts). Its jobs are only:
 *   1. keep the session cookie fresh (refresh an expired access token), and
 *   2. send signed-out visitors to /login and signed-in ones away from it.
 *
 * It deliberately does NOT verify the user against the Auth server or load
 * the profile on dashboard requests any more. It used to do both — two
 * sequential round trips — and then every page did them again in
 * requireSession(): four round trips before any data was read, on every
 * navigation, prefetch and server action. Authorization happens once, in
 * requireSession() (verified with the Auth server + PostgREST), in every
 * server action, and in RLS; role checks for /orders/new, /settings, /data
 * and /activity live in those pages (requireRole / ctx.can).
 *
 * The one place it still verifies is /login (and /): redirecting a
 * signed-in visitor away from the login page must not trust an unverified
 * cookie, or a revoked session would bounce between /login and /dashboard.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const path = request.nextUrl.pathname;
  const isDashboard = path.startsWith(DASHBOARD_PREFIX);
  const isEntry = path === "/login" || path === "/";

  const to = (pathname: string) => {
    const u = request.nextUrl.clone();
    u.pathname = pathname;
    u.search = "";
    return NextResponse.redirect(u);
  };

  if (!url || !key) return isDashboard ? to("/login") : response;

  const supabase = createServerClient(url, key, {
    global: { fetch: timedFetch },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // temporary timing (performance investigation): one log line per check
  const t0 = performance.now();
  const log = (step: string, extra: Record<string, unknown>) =>
    console.log(JSON.stringify({ perf: "proxy", step, path, ms: Math.round(performance.now() - t0), ...extra }));

  if (isEntry) {
    const user = await withTimeout(supabase.auth.getUser().then((r) => r.data.user));
    log("getUser", { user: Boolean(user) });
    return user ? to("/dashboard/orders") : response;
  }

  if (isDashboard) {
    // Local cookie read; only touches the network when the access token has
    // expired and needs refreshing (the new cookies are written above).
    const r = await withTimeout(supabase.auth.getSession());
    // Couldn't check (the refresh timed out, or the network failed): NOT a
    // sign-out. The cookies are kept, and the page's own session check
    // decides, showing "Try again" if it can't check either. Sending the
    // user to /login here signed people out after a phone had been away
    // for an hour on a slow connection.
    const unknown = r === null || (!r.data.session && isAuthRetryableFetchError(r.error));
    log("getSession", { session: Boolean(r?.data.session), unknown });
    if (!unknown && !r?.data.session) return to("/login");
  }

  return response;
}
