"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SELF_SELECTABLE_ROLES, type Role } from "@/lib/permissions";

export type ActionState = { error?: string; ok?: string } | null;

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/* ------------------------------------------------------------------ sign up */
export async function signUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const contact = String(formData.get("contact") ?? "").trim();
  const method = String(formData.get("contact_method") ?? "email");
  const password = String(formData.get("password") ?? "");
  const requestedRole = String(formData.get("requested_role") ?? "") as Role;

  if (!fullName) return { error: "Enter your full name." };
  if (password.length < 8)
    return { error: "Password must be at least 8 characters." };
  if (!SELF_SELECTABLE_ROLES.includes(requestedRole))
    return { error: "Select a valid role." };

  if (method === "phone") {
    return {
      error:
        "Phone registration is being enabled. Please register with an email address for now.",
    };
  }
  if (!isEmail(contact)) return { error: "Enter a valid email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: contact,
    password,
    options: {
      data: {
        full_name: fullName,
        phone: null,
        contact_method: "email",
        requested_role: requestedRole,
      },
    },
  });

  if (error) return { error: error.message };

  // handle_new_user trigger created a pending profile + signup_request.
  redirect("/pending-approval?new=1");
}

/* --------------------------------------------------------------- login (2FA) */
export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!isEmail(email) || !password)
    return { error: "Enter your email and password." };

  const supabase = await createClient();

  // Primary factor: password. Always required.
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) return { error: "Incorrect email or password." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("status, is_demo_account, contact_method")
    .eq("id", data.user.id)
    .single();

  if (!profile) return { error: "Account not found." };
  if (profile.status === "pending") redirect("/pending-approval");
  if (profile.status === "rejected") redirect("/pending-approval?state=rejected");
  if (profile.status === "suspended")
    return { error: "This account is suspended. Contact an administrator." };

  // Demo accounts and phone accounts skip the email second factor.
  if (profile.is_demo_account || profile.contact_method === "phone") {
    redirect("/dashboard/overview");
  }

  // Second factor: email OTP. Drop the password session, send a code.
  await supabase.auth.signOut();
  const { error: otpErr } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  if (otpErr) return { error: otpErr.message };

  redirect(`/verify-otp?email=${encodeURIComponent(email)}`);
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
  revalidatePath("/pending-approval");
  return { ok: "Your request has been resubmitted." };
}

/* -------------------------------------------------------------------- sign out */
export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/signin");
}
