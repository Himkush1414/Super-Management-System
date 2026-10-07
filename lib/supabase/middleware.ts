import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

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
    const session = await withTimeout(supabase.auth.getSession().then((r) => r.data.session));
    log("getSession", { session: Boolean(session) });
    if (!session) return to("/login");
  }

  return response;
}
