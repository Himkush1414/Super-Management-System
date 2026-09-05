import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { can, type Role } from "@/lib/permissions";

/** Route groups that require an authenticated, active session. */
const DASHBOARD_PREFIX = "/dashboard";

/**
 * Per-path minimum permission. Checked after auth + active-status. A path
 * must satisfy every guard whose prefix it matches (e.g.
 * /dashboard/approvals/review matches both the "review" and the plain
 * "approvals" guard below, so Head Admin needs both perms — which they do).
 */
const ROUTE_GUARDS: { prefix: string; perm: Parameters<typeof can>[1] }[] = [
  { prefix: "/dashboard/users", perm: "users.changeRole" },
  { prefix: "/dashboard/approvals/review", perm: "approvals.decide" },
  { prefix: "/dashboard/approvals", perm: "approvals.view" },
  { prefix: "/dashboard/audit-log", perm: "audit.view" },
];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const path = request.nextUrl.pathname;

  // Without Supabase configured, only guard the dashboard (send to sign-in).
  if (!url || !key) {
    if (path.startsWith(DASHBOARD_PREFIX)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/signin";
      return NextResponse.redirect(redirectUrl);
    }
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  let user = null;
  try {
    user = (await supabase.auth.getUser()).data.user;
  } catch {
    user = null;
  }

  const isDashboard = path.startsWith(DASHBOARD_PREFIX);
  const isAuthPage =
    path.startsWith("/signin") ||
    path.startsWith("/signup") ||
    path.startsWith("/verify-otp");

  // Unauthenticated user hitting the dashboard -> bounce to sign in.
  if (!user && isDashboard) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (user && (isDashboard || isAuthPage)) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, status")
      .eq("id", user.id)
      .single();

    const status = profile?.status;
    const role = profile?.role as Role | undefined;

    // Suspended is a hard lockout, unlike pending/rejected below.
    if (status === "suspended") {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/signin";
      return NextResponse.redirect(url);
    }

    // Signed in but not yet approved: send auth-page visits into the
    // dashboard shell (whose layout renders the PendingGate); dashboard
    // visits pass through untouched — no route-guard checks below apply,
    // since a pending/rejected profile has no real capabilities anyway.
    //
    // GET-only: the sign-up wizard's own steps are POSTs (Server Actions)
    // to /signup made *after* the OTP session cookie already exists (e.g.
    // setSignupPassword, called while status is still "pending"). Redirecting
    // those hijacks the action before it runs — the browser's action-fetch
    // follows the redirect and the framework treats the resulting page
    // response as a malformed action reply. Only intercept real navigations.
    if (status !== "active") {
      if (isAuthPage && request.method === "GET") {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard/overview";
        return NextResponse.redirect(url);
      }
      return response;
    }

    // Active user landing on an auth page -> send to the dashboard.
    if (isAuthPage && request.method === "GET") {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard/overview";
      return NextResponse.redirect(url);
    }

    // Per-route permission guards.
    for (const guard of ROUTE_GUARDS) {
      if (path.startsWith(guard.prefix) && !can(role ?? null, guard.perm)) {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard/overview";
        url.searchParams.set("denied", guard.prefix);
        return NextResponse.redirect(url);
      }
    }
  }

  return response;
}
