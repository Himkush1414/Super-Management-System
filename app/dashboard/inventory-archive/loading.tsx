import { StillLoading } from "@/components/shared/StillLoading";

/** Archive skeleton, shown at once on navigation (same footprint as the page). */
export default function InventoryArchiveLoading() {
  return (
    <>
      <StillLoading />
      <div aria-busy="true" aria-label="Loading the archive" className="animate-pulse motion-reduce:animate-none">
        <div className="mb-6 space-y-2">
          <div className="h-3 w-12 rounded bg-panel-2" />
          <div className="h-7 w-40 rounded-md bg-elevated" />
          <div className="h-3.5 w-96 max-w-full rounded bg-panel-2" />
        </div>
        <div className="mb-4 h-11 rounded-xl border border-border bg-panel/60" />
        <div className="space-y-2.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 rounded-xl border border-border bg-panel/60" />
          ))}
        </div>
      </div>
    </>
  );
}
