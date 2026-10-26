// @ts-check
// Expo app config for NR Management — the Android/iOS wrapper around the
// live NR Industries website. Values that differ per environment come from
// EAS environment variables (never committed); see .env.example.

import fs from "node:fs";
import path from "node:path";

const APP_ID = "com.midashq.nrmanagement"; // never change after the first store/APK build
const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL || "https://super-management-system-tau.vercel.app";

// google-services.json is a secret file: EAS injects it through the
// GOOGLE_SERVICES_JSON file variable (its value is the path on the build
// machine). Without it the app still builds and runs; push stays off.
const googleServicesFile = (() => {
  const p = process.env.GOOGLE_SERVICES_JSON;
  if (p && fs.existsSync(p)) return p;
  // local builds only: expo commands run from this folder
  return fs.existsSync(path.resolve("google-services.json")) ? "./google-services.json" : undefined;
})();

/** @type {import('expo/config').ExpoConfig} */
const config = {
  name: "NR Management",
  slug: "nr-management",
  owner: "midas-hq",
  scheme: "nrmanagement",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  backgroundColor: "#0a0a0a",
  ios: {
    bundleIdentifier: APP_ID,
    supportsTablet: true,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      // HTTPS only (App Transport Security default, stated explicitly)
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
    },
  },
  android: {
    package: APP_ID,
    adaptiveIcon: {
      backgroundColor: "#0a0a0a",
      foregroundImage: "./assets/android-icon-foreground.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    ...(googleServicesFile ? { googleServicesFile } : {}),
    permissions: ["android.permission.POST_NOTIFICATIONS"],
    blockedPermissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.CAMERA",
    ],
  },
  plugins: [
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 180,
        resizeMode: "contain",
        backgroundColor: "#0a0a0a",
      },
    ],
    [
      "expo-build-properties",
      {
        android: { usesCleartextTraffic: false },
      },
    ],
    "expo-sharing",
  ],
  extra: {
    webUrl: WEB_URL,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || "",
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "",
    pushConfigured: Boolean(googleServicesFile),
    // EAS project @midas-hq/nr-management (created by eas init); push tokens need it
    eas: { projectId: "eb0bdd99-b5a8-4822-bf28-61185046267c" },
  },
};

export default config;
