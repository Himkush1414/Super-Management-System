"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; ok?: string } | null;
export type WizardState = { error?: string; ok?: string; devCode?: string } | null;

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const isSixDigitPassword = (v: string) => /^\d{6}$/.test(v);

const OTP_TTL_MS = 10 * 60 * 1000;
const hashCode = (code: string) => crypto.createHash("sha256").update(code).digest("hex");
const randomCode = () => String(crypto.randomInt(100000, 1000000));

/* =====================================================================
 * SIGN-UP WIZARD — identity + OTP first, no role selection. Role is
 * assigned exclusively by Head Admin at approval (spec §2, §3).
 * ===================================================================== */

/** Step 3: send the OTP. Email is real (Supabase Auth). Phone is a stub —
 * no SMS integration; the code is logged server-side and returned to the
 * caller so the dev UI can display it (spec: "dev-visible/logged code"). */
export async function startSignup(input: {
  fullName: string;
  method: "email" | "phone";
  contact: string;
}): Promise<WizardState> {
  const fullName = input.fullName.trim();
  const contact = input.contact.trim();
  if (!fullName) return { error: "Enter your full name." };

  if (input.method === "email") {
    if (!isEmail(contact)) return { error: "Enter a valid email address." };
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: contact,
      options: { shouldCreateUser: true, data: { full_name: fullName, contact_method: "email" } },
    });
    if (error) return { error: error.message };
    return { ok: "Code sent." };
  }

  if (!contact) return { error: "Enter a valid phone number." };
  const code = randomCode();
  console.log(`[phone-otp-stub] code for ${contact}: ${code}`);

  const service = createServiceClient();
  const { error } = await service.from("phone_otp_codes").upsert({
    phone: contact,
    code_hash: hashCode(code),
    expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    verified: false,
  });
  if (error) return { error: error.message };

  return { ok: "Code sent.", devCode: code };
}

/** Step 4: verify the OTP. */
export async function verifySignupOtp(input: {
  method: "email" | "phone";
  contact: string;
  token: string;
}): Promise<WizardState> {
  const contact = input.contact.trim();
  const token = input.token.trim();
  if (token.length !== 6) return { error: "Enter the 6-digit code." };

  if (input.method === "email") {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ email: contact, token, type: "email" });
    if (error) return { error: "That code is invalid or has expired." };
    return { ok: "Verified." };
  }

  const service = createServiceClient();
  const { data: row } = await service
    .from("phone_otp_codes")
    .select("code_hash, expires_at")
    .eq("phone", contact)
    .maybeSingle();

  if (!row || row.code_hash !== hashCode(token) || new Date(row.expires_at) < new Date()) {
    return { error: "That code is invalid or has expired." };
  }

  const { error } = await service
    .from("phone_otp_codes")
    .update({ verified: true })
    .eq("phone", contact);
  if (error) return { error: error.message };
  return { ok: "Verified." };
}

/** Step 5: set the 6-digit numeric password and create the pending account. */
export async function setSignupPassword(input: {
  fullName: string;
  method: "email" | "phone";
  contact: string;
  password: string;
}): Promise<WizardState> {
  if (!isSixDigitPassword(input.password)) {
    return { error: "Password must be exactly 6 digits (numbers only)." };
  }
  const fullName = input.fullName.trim();
  const contact = input.contact.trim();

  if (input.method === "email") {
    // A live session already exists from verifySignupOtp's verifyOtp() call.
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password: input.password });
    if (error) return { error: error.message };
    redirect("/dashboard/overview");
  }

  const service = createServiceClient();
  const { data: row } = await service
    .from("phone_otp_codes")
    .select("verified, expires_at")
    .eq("phone", contact)
    .maybeSingle();
  if (!row?.verified || new Date(row.expires_at) < new Date()) {
    return { error: "Verify your phone number again before setting a password." };
  }

  // Stub scope: no real SMS provider is ever invoked. We already verified
  // the phone via our own logged code above, so the auth user is created
  // with phone_confirm: true directly through the admin API.
  const { error: createErr } = await service.auth.admin.createUser({
    phone: contact,
    password: input.password,
    phone_confirm: true,
    user_metadata: { full_name: fullName, contact_method: "phone" },
  });
  if (createErr) return { error: createErr.message };

  await service.from("phone_otp_codes").delete().eq("phone", contact);

  const supabase = await createClient();
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    phone: contact,
    password: input.password,
  });
  if (signInErr) return { error: signInErr.message };

  redirect("/dashboard/overview");
}

/* --------------------------------------------------------------- login (2FA) */
export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!identifier || !password) return { error: "Enter your email/phone and password." };

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword(
    isEmail(identifier) ? { email: identifier, password } : { phone: identifier, password },
  );
  if (error) return { error: "Incorrect credentials." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("status, is_demo_account, contact_method, role, last_active_at")
    .eq("id", data.user.id)
    .single();

  if (!profile) return { error: "Account not found." };
  if (profile.status === "suspended") {
    await supabase.auth.signOut();
    return { error: "This account is suspended. Contact an administrator." };
  }
  // Pending / rejected accounts land on the dashboard shell's own gate now.
  if (profile.status !== "active") redirect("/dashboard/overview");

  // Head Admin: same login screen, silently skips the OTP second factor —
  // no visible difference in the form, the branch is entirely server-side.
  if (isEmail(identifier) && identifier.toLowerCase() === process.env.HEAD_ADMIN_EMAIL?.toLowerCase()) {
    redirect("/dashboard/overview");
  }

  // Forced-expiry re-login (7 days inactive, spec §2): password only, no
  // OTP re-send, distinct from a normal fresh login below.
  const staleMs = 7 * 24 * 60 * 60 * 1000;
  const lastActive = profile.last_active_at ? new Date(profile.last_active_at).getTime() : 0;
  if (profile.role !== "head_admin" && Date.now() - lastActive > staleMs) {
    redirect("/dashboard/overview");
  }

  // Demo accounts and phone accounts skip the email second factor.
  if (profile.is_demo_account || profile.contact_method === "phone") {
    redirect("/dashboard/overview");
  }

  // Second factor: email OTP. Drop the password session, send a code.
  await supabase.auth.signOut();
  const { error: otpErr } = await supabase.auth.signInWithOtp({
    email: identifier,
    options: { shouldCreateUser: false },
  });
  if (otpErr) return { error: otpErr.message };

  redirect(`/verify-otp?email=${encodeURIComponent(identifier)}`);
}

/* --------------------------------------------------------------- verify OTP */
export async function verifyOtpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();
  if (!isEmail(email) || token.length < 6)
    return { error: "Enter the 6-digit code sent to your email." };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error) return { error: "That code is invalid or has expired." };

  redirect("/dashboard/overview");
}

export async function resendOtpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!isEmail(email)) return { error: "Missing email." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  if (error) return { error: error.message };
  return { ok: "A new code is on its way." };
}

/* ------------------------------------------------------------------- re-apply */
export async function reapplyAction(): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reapply_signup", { requested: null });
  if (error) return { error: error.message };
  revalidatePath("/dashboard", "layout");
  return { ok: "Your request has been resubmitted." };
}

/* -------------------------------------------------------------------- sign out */
export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/signin");
}
