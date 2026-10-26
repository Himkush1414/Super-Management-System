// @ts-check
// New-order push notifications on the phone.
//
// Flow: the website's session (read by the page bridge from its own
// cookie, src/injected.js) tells us who is signed in. Then we ask for
// notification permission, get this phone's Expo push token and register
// it for that user (register_device_token, with the user's own access
// token + the anon key, RLS-scoped). On sign-out we unregister it.
//
// Everything here is optional: without google-services.json (Android),
// an EAS project id, or the Supabase URL/key, the app still runs and the
// website still works live; registration is skipped with one log line.
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import Constants from "expo-constants";
import { EAS_PROJECT_ID, PUSH_CONFIGURED, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

export const CHANNEL_ID = "new_orders";
const REREGISTER_MS = 12 * 60 * 60 * 1000; // refresh last_seen twice a day at most

// Show new-order notifications while the app is open, too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** @param {string} msg */
const log = (msg) => console.log(`[push] ${msg}`);

/** Why push can't work in this build, or null if it can. */
export function pushUnavailableReason() {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return "unsupported platform";
  if (!Device.isDevice) return "not a physical device";
  if (Platform.OS === "android" && !PUSH_CONFIGURED) return "Firebase (google-services.json) not configured in this build";
  if (!EAS_PROJECT_ID) return "no EAS project id in this build";
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return "Supabase URL / anon key not set for this build";
  return null;
}

/** High-importance channel with sound (Android 8+). Safe to call repeatedly. */
export async function ensureChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "New orders",
    description: "A new order was punched for you or your team",
    importance: AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 250, 150, 250],
    enableVibrate: true,
    showBadge: true,
  });
}

/**
 * Permission (POST_NOTIFICATIONS on Android 13+, the system prompt on iOS)
 * and this phone's Expo push token, or null. With prompt=false it never
 * shows the permission dialog (used on sign-out).
 * @param {{ prompt: boolean }} opts
 * @returns {Promise<string | null>}
 */
async function getExpoToken({ prompt }) {
  const why = pushUnavailableReason();
  if (why) {
    log(`registration skipped: ${why}`);
    return null;
  }
  await ensureChannel();
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted" && prompt) ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== "granted") {
    log("notification permission not granted");
    return null;
  }
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId: /** @type {string} */ (EAS_PROJECT_ID) });
  return data;
}

/**
 * @param {string} fn
 * @param {Record<string, unknown>} args
 * @param {string} bearer  user access token, or the anon key
 */
async function rpc(fn, args, bearer) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (res.status === 404) throw new Error(`${fn} not found (supabase/mobile SQL not applied yet?)`);
  if (!res.ok) throw new Error(`${fn} ${res.status}`);
}

/**
 * Keeps this phone registered for whoever is signed in on the website.
 * Feed it every session report from the page; it only talks to the
 * server when something actually changed.
 */
export function createPushRegistrar() {
  /** @type {string | null} */ let pushToken = null;
  /** @type {Promise<string | null> | null} */ let tokenPromise = null;
  /** @type {{ userId: string, accessToken: string } | null} */ let session = null;
  /** @type {{ key: string, at: number } | null} */ let registered = null;
  let unregisteredOnce = false;
  let busy = Promise.resolve();

  const token = (prompt = true) => {
    if (pushToken) return Promise.resolve(pushToken);
    if (!tokenPromise) {
      tokenPromise = getExpoToken({ prompt })
        .then((t) => (pushToken = t))
        .catch((e) => {
          log(`could not get a push token: ${e?.message ?? e}`);
          return null;
        })
        .finally(() => (tokenPromise = null));
    }
    return tokenPromise;
  };

  const sync = async () => {
    if (session) {
      const s = session;
      const t = await token();
      if (!t) return;
      const key = `${s.userId}|${t}`;
      if (registered && registered.key === key && Date.now() - registered.at < REREGISTER_MS) return;
      await rpc("register_device_token", {
        p_token: t,
        p_platform: Platform.OS,
        p_app_version: Constants.expoConfig?.version ?? null,
      }, s.accessToken);
      registered = { key, at: Date.now() };
      unregisteredOnce = false;
      log("registered for new-order notifications");
    } else {
      // signed out (or the session expired): this phone must stop getting
      // that user's notifications. Idempotent, once per sign-out.
      if (unregisteredOnce) return;
      // never prompt for permission on the login screen
      const t = pushToken ?? (await token(false));
      if (!t) return;
      await rpc("unregister_device_token", { p_token: t }, SUPABASE_ANON_KEY);
      registered = null;
      unregisteredOnce = true;
      log("unregistered (signed out)");
    }
  };

  const run = () => {
    busy = busy.then(sync).catch((e) => log(`sync failed: ${e?.message ?? e}`));
    return busy;
  };

  return {
    /** @param {{ userId: string | null, accessToken?: string }} s */
    onSession(s) {
      session = s.userId && s.accessToken ? { userId: s.userId, accessToken: s.accessToken } : null;
      return run();
    },
    /** The OS rotated the device token: get a fresh Expo token and re-register. */
    onTokenChanged() {
      pushToken = null;
      registered = null;
      return run();
    },
  };
}
