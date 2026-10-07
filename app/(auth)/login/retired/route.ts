import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ROLES } from "@/lib/permissions";

/**
 * Where requireSession() sends a signed-in account whose role the app no
 * longer has — the retired `dispatcher` accounts (0024). Their session
 * cookies are dropped here, in this browser only (nothing is deleted on the
 * server), and they land on /login, where their PIN no longer signs in
 * (lib/auth/actions.ts). A plain redirect to /login would loop: the proxy
 * sends any signed-in visitor straight back to the dashboard. Every other
 * account is just sent on, untouched.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle<{ role: string }>()
    : { data: null };

  if (profile && (ROLES as readonly string[]).includes(profile.role)) {
    return NextResponse.redirect(new URL("/dashboard/orders", request.url));
  }
  const response = NextResponse.redirect(new URL("/login", request.url));
  for (const c of request.cookies.getAll()) {
    if (c.name.startsWith("sb-")) response.cookies.delete(c.name);
  }
  return response;
}
