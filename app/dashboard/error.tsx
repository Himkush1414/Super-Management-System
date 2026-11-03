"use client";

import { LoadError } from "@/components/shared/LoadError";

/** A dashboard page whose data didn't load: "Try again" inside the dashboard. */
export default function DashboardError({ error, retry }: { error: unknown; retry: () => void }) {
  return <LoadError error={error} retry={retry} />;
}
