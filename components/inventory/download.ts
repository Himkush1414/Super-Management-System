"use client";

/**
 * One-tap file download for the Inventory exports, on the website and in
 * the Android app. Resolves once the file is saved (browser) or handed to
 * the app (the app then shows its own "Downloaded" sheet); rejects with a
 * message the screen can show.
 *
 * - Android app (window.ReactNativeWebView): the app's own bridge,
 *   window.__nrFetchFile, fetches the file with the session and passes it
 *   to the app in pieces (mobile/src/injected.js). We watch the bridge's
 *   messages for that download's end, so the button stays on "Preparing…"
 *   exactly as long as it takes. An older app without the bridge gets a
 *   plain navigation, which its native download handler catches.
 * - Browser: fetch the file, then save it under its name from a blob.
 */
type Bridge = { postMessage: (m: string) => void };
type AppWindow = Window & { ReactNativeWebView?: Bridge; __nrFetchFile?: (url: string) => void };

const APP_LIMIT_MS = 125_000; // the bridge gives up after 120 s and says so itself

export function inApp(): boolean {
  return typeof window !== "undefined" && Boolean((window as AppWindow).ReactNativeWebView);
}

export async function downloadFile(url: string, filename: string): Promise<void> {
  const w = window as AppWindow;
  const abs = new URL(url, window.location.href).href;

  if (w.ReactNativeWebView) {
    if (typeof w.__nrFetchFile !== "function") {
      window.location.href = abs; // older app: its native download handler takes it
      return;
    }
    const bridge = w.ReactNativeWebView;
    await new Promise<void>((resolve) => {
      const original = bridge.postMessage;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(limit);
        try {
          bridge.postMessage = original;
        } catch {
          /* read-only bridge: nothing was replaced */
        }
        resolve();
      };
      const limit = setTimeout(finish, APP_LIMIT_MS);
      try {
        bridge.postMessage = function (m: string) {
          try {
            const msg = JSON.parse(m) as { type?: string };
            if (msg.type === "file-end" || msg.type === "file-error") setTimeout(finish, 0);
          } catch {
            /* not JSON: not ours */
          }
          return original.call(bridge, m);
        };
      } catch {
        // can't watch the bridge: keep "Preparing…" a moment, the app shows its own progress
        setTimeout(finish, 2500);
      }
      w.__nrFetchFile!(abs);
    });
    return;
  }

  const res = await fetch(abs, { credentials: "same-origin", cache: "no-store" });
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!res.ok || type.includes("text/html")) {
    throw new Error(
      type.includes("text/html")
        ? "You were signed out. Sign in again, then download."
        : res.status === 403
          ? "Not permitted."
          : "The file couldn't be made just now. Please try again.",
    );
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
