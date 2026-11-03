"use client";

import { LoadError } from "@/components/shared/LoadError";

/**
 * Errors above the dashboard pages (the dashboard layout's own session
 * check): the same "Try again", without the sidebar.
 */
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="flex flex-1 items-start justify-center px-4">
      <LoadError error={error} retry={retry} />
    </main>
  );
}
