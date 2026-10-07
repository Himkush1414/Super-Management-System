"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { perf } from "@/lib/perf";
import { ROLES } from "@/lib/permissions";

export type ActionState = { error?: string } | null;

function clientIp(h: Headers): string {
  // Set by the hosting platform (Vercel overwrites client-supplied values).
  return (
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function lockMessage(seconds: number) {
  const mins = Math.max(1, Math.ceil(seconds / 60));
  return `Too many incorrect PINs. Sign-in for this account is locked — try again in ${mins} minute${mins === 1 ? "" : "s"}.`;
}

/**
 * The only way into the app: username + 6-digit PIN.
 *
 * The PIN is checked in Postgres by pin_login_attempt() — bcrypt, with
 * per-account and per-IP lockout applied atomically (migration 0014). It is
 * NOT the Supabase Auth password (that is a random value nobody knows), so
 * GoTrue's public password endpoint can't be used to brute-force PINs around
 * this lockout. On success the server mints the session with a single-use
 * token (admin generateLink -> verifyOtp), which sets the auth cookies.
 */
export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const pin = String(formData.get("pin") ?? "").trim();

  if (!username || !pin) return { error: "Enter your username and PIN." };
  if (!/^\d{6}$/.test(pin)) return { error: "Your PIN is exactly 6 digits." };
  if (!/^[a-z0-9_]{2,32}$/.test(username)) {
    return { error: "Incorrect username or PIN." };
  }

  const pf = perf("login");
  const svc = createServiceClient();
  const { data, error } = await pf.time("pin_login_attempt", svc
    .rpc("pin_login_attempt", {
      p_username: username,
      p_pin: pin,
      p_ip: clientIp(await headers()),
    })
    .single<{
      ok: boolean;
      user_id: string | null;
      email: string | null;
      retry_after_seconds: number;
      attempts_left: number;
    }>());
  if (error || !data) return { error: "Sign-in is unavailable right now. Please try again." };

  if (!data.ok) {
    if (data.retry_after_seconds > 0) return { error: lockMessage(data.retry_after_seconds) };
    return {
      error:
        data.attempts_left <= 3
          ? `Incorrect username or PIN. ${data.attempts_left} attempt${data.attempts_left === 1 ? "" : "s"} left before a 15-minute lock.`
          : "Incorrect username or PIN.",
    };
  }

  // In parallel: the one-time session token, and whether this account still
  // has to finish setup (real name; production also phone) — if so it goes
  // straight to Settings instead of bouncing off the orders page.
  const [{ data: link, error: linkErr }, { data: me }] = await Promise.all([
    pf.time("auth.generateLink", svc.auth.admin.generateLink({ type: "magiclink", email: data.email! })),
    pf.time(
      "profile",
      svc
        .from("profiles")
        .select("role, real_name, production_settings(phone, confirmed_at)")
        .eq("id", data.user_id!)
        .maybeSingle(),
    ),
  ]);
  if (linkErr || !link?.properties?.hashed_token) {
    return { error: "Sign-in is unavailable right now. Please try again." };
  }
  // A role the app no longer has (the retired dispatchers, 0024): the PIN
  // is right, but no session is created.
  if (!me || !(ROLES as readonly string[]).includes(me.role)) {
    return { error: "This account is no longer in use." };
  }
  const supabase = await createClient();
  const { error: otpErr } = await pf.time("auth.verifyOtp", supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  }));
  pf.end({ ok: !otpErr });
  if (otpErr) return { error: "Sign-in is unavailable right now. Please try again." };

  const ps = (Array.isArray(me?.production_settings) ? me.production_settings[0] : me?.production_settings) as
    | { phone: string | null; confirmed_at: string | null }
    | null
    | undefined;
  const needsSetup =
    (me.role === "marketing" || me.role === "production") &&
    (!me.real_name || (me.role === "production" && !(ps?.phone && ps.confirmed_at)));
  redirect(needsSetup ? "/dashboard/settings" : "/dashboard/orders");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
