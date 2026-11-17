import { StillLoading } from "@/components/shared/StillLoading";

/** Inventory settings skeleton, shown at once on navigation (same footprint as the page). */
export default function InventorySettingsLoading() {
  return (
    <>
      <StillLoading />
      <div aria-busy="true" aria-label="Loading inventory settings" className="animate-pulse motion-reduce:animate-none">
        <div className="mb-6 space-y-2">
          <div className="h-3 w-12 rounded bg-panel-2" />
          <div className="h-7 w-52 rounded-md bg-elevated" />
          <div className="h-3.5 w-96 max-w-full rounded bg-panel-2" />
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)] lg:items-start">
          <div className="h-72 rounded-xl border border-border bg-panel/60" />
          <div className="h-96 rounded-xl border border-border bg-panel/60" />
        </div>
      </div>
    </>
  );
}
