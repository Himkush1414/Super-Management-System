import { StillLoading } from "@/components/shared/StillLoading";

/** Inventory skeleton: header, summary cards, sticky search, rows — same footprint as the page (no layout shift). */
export default function InventoryLoading() {
  return (
    <>
      <StillLoading />
      <div aria-busy="true" aria-label="Loading inventory" className="animate-pulse motion-reduce:animate-none">
        <div className="mb-5 space-y-2">
          <div className="h-3 w-12 rounded bg-panel-2" />
          <div className="h-7 w-36 rounded-md bg-elevated" />
          <div className="h-3.5 w-80 max-w-full rounded bg-panel-2" />
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={`h-[86px] rounded-xl border border-border bg-panel/60 ${i === 1 ? "col-span-2 lg:col-span-1" : ""}`} />
          ))}
        </div>
        <div className="mt-5 border-b border-border py-3">
          <div className="h-11 w-full max-w-md rounded-xl bg-elevated" />
        </div>
        <div className="mt-4 space-y-2.5 md:space-y-0 md:overflow-hidden md:rounded-xl md:border md:border-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex h-[8.5rem] flex-col justify-center gap-2 rounded-xl border border-border px-4 md:h-[3.25rem] md:flex-row md:items-center md:gap-6 md:rounded-none md:border-0 md:border-b">
              <div className="h-3.5 w-16 rounded bg-elevated" />
              <div className="h-3.5 w-2/5 rounded bg-panel-2" />
              <div className="hidden h-3.5 w-1/6 rounded bg-panel-2 md:block" />
              <div className="h-3.5 w-14 rounded bg-panel-2 md:ml-auto" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
