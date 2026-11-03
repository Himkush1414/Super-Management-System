"use client";

import { useState } from "react";

/**
 * What a page shows when its data couldn't be loaded (a read timed out, the
 * server or the connection failed): an honest message and "Try again",
 * instead of an empty list, "not found", or the sign-in page.
 *
 * `retry` (Next 16.3+) fetches and renders the segment again without
 * reloading the browser tab, so the rest of the page and the session stay.
 */
export function LoadError({ retry, error }: { retry: () => void; error: unknown }) {
  const [trying, setTrying] = useState(false);
  const digest = error && typeof error === "object" && "digest" in error ? String((error as { digest?: unknown }).digest ?? "") : "";
  return (
    <div role="alert" className="mx-auto mt-10 max-w-md rounded-xl border border-border bg-panel/60 p-6 text-center">
      <p className="font-medium">This page didn&apos;t load.</p>
      <p className="mt-1 text-[13px] text-text-secondary">
        The server or the connection was too slow just now. Nothing was changed and your data is safe.
      </p>
      <button
        type="button"
        disabled={trying}
        onClick={() => {
          setTrying(true);
          retry();
          // the boundary is replaced when the page arrives; if it fails again
          // this same screen comes back, so let the button work again
          setTimeout(() => setTrying(false), 3000);
        }}
        className="nr-interactive nr-press mt-4 inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
      >
        {trying ? "Trying…" : "Try again"}
      </button>
      {digest && <p className="mt-3 text-[11px] text-text-tertiary">Reference: {digest}</p>}
    </div>
  );
}
