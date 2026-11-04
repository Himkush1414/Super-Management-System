"use client";

import { useEffect, useState } from "react";

/** The server ends a slow page itself by about 10 s, so past this the connection is the problem. */
const AFTER_MS = 12000;

/**
 * Part of the loading skeletons. The router waits for its page request with
 * no time limit, so a connection that died on the way would leave the
 * skeleton up for good. After a while this offers a way out. It unmounts with
 * the skeleton, so a page that lands first never shows it.
 */
export function StillLoading() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), AFTER_MS);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-panel/60 px-4 py-3">
      <p className="text-[13px] text-text-secondary">Still loading… Check your connection, or reload the page.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="nr-interactive nr-press inline-flex h-9 shrink-0 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover"
      >
        Reload
      </button>
    </div>
  );
}
