// @ts-check
import Constants from "expo-constants";
import { makePolicy } from "./links";

const extra = /** @type {Record<string, any>} */ (Constants.expoConfig?.extra ?? {});

export const WEB_URL = String(extra.webUrl || "https://super-management-system-tau.vercel.app").replace(/\/+$/, "");
export const SUPABASE_URL = String(extra.supabaseUrl || "").replace(/\/+$/, "");
export const SUPABASE_ANON_KEY = String(extra.supabaseAnonKey || "");
export const PUSH_CONFIGURED = Boolean(extra.pushConfigured);
export const EAS_PROJECT_ID = extra.eas?.projectId ?? Constants.easConfig?.projectId ?? null;

export const POLICY = makePolicy(WEB_URL, SUPABASE_URL || undefined);

/** Login lands here; also the fallback for notification taps. */
export const START_URL = `${WEB_URL}/dashboard/orders`;
