import { StillLoading } from "@/components/shared/StillLoading";

/** Import skeleton, shown at once on navigation. */
export default function InventoryImportLoading() {
  return (
    <>
      <StillLoading />
      <div aria-busy="true" aria-label="Loading the import" className="animate-pulse motion-reduce:animate-none">
        <div className="mb-6 space-y-2">
          <div className="h-3 w-12 rounded bg-panel-2" />
          <div className="h-7 w-60 rounded-md bg-elevated" />
          <div className="h-3.5 w-96 max-w-full rounded bg-panel-2" />
        </div>
        <div className="h-48 rounded-xl border border-border bg-panel/60" />
      </div>
    </>
  );
}
