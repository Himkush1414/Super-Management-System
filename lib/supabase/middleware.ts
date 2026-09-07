import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { type Role, can } from "@/lib/permissions";

const DASHBOARD_PREFIX = "/dashboard";

/** Per-path minimum permission, checked after auth. */
const ROUTE_GUARDS: { prefix: string; perm: Parameters<typeof can>[1] }[] = [
  { prefix: "/dashboard/orders/new", perm: "orders.dispatch" },
  { prefix: "/dashboard/settings", perm: "production.settings" },
];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const path = request.nextUrl.pathname;
  const isDashboard = path.startsWith(DASHBOARD_PREFIX);
  const isLogin = path === "/login";

  if (!url || !key) {
    if (isDashboard) {
      const u = request.nextUrl.clone();
      u.pathname = "/login";
      return NextResponse.redirect(u);
    }
    return response;
  }

  const supabase = createServerClient(url, key, {
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
  });

  let user = null;
  try {
    user = (await supabase.auth.getUser()).data.user;
  } catch {
    user = null;
  }

  if (!user) {
    if (isDashboard) {
      const u = request.nextUrl.clone();
      u.pathname = "/login";
      return NextResponse.redirect(u);
    }
    return response;
  }

  // Signed in.
  if (isLogin || path === "/") {
    const u = request.nextUrl.clone();
    u.pathname = "/dashboard/orders";
    return NextResponse.redirect(u);
  }

  if (isDashboard) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    const role = profile?.role as Role | undefined;

    for (const guard of ROUTE_GUARDS) {
      if (path.startsWith(guard.prefix) && !can(role ?? null, guard.perm)) {
        const u = request.nextUrl.clone();
        u.pathname = "/dashboard/orders";
        return NextResponse.redirect(u);
      }
    }
  }

  return response;
}
