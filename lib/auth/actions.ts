"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string } | null;

/** Internal: every account is <username>@nr.local in Supabase Auth. */
const INTERNAL_DOMAIN = "nr.local";
const toInternalEmail = (username: string) =>
  `${username.trim().toLowerCase()}@${INTERNAL_DOMAIN}`;

/**
 * The only way into the app. Username + password, matched against the fixed
 * seeded accounts. No signup, no OTP, no recovery.
 */
export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    return { error: "Enter your username and password." };
  }
  if (!/^[a-z0-9_]{2,32}$/i.test(username)) {
    return { error: "Incorrect username or password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: toInternalEmail(username),
    password,
  });
  if (error) return { error: "Incorrect username or password." };

  redirect("/dashboard/orders");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
