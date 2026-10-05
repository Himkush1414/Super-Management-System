/** Route-level fallback: shown instantly on navigation while the server renders. */
export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse">
      <div className="mb-6 space-y-2">
        <div className="h-6 w-44 rounded-md bg-elevated" />
        <div className="h-3.5 w-72 max-w-full rounded bg-panel-2" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[76px] rounded-xl border border-border bg-panel/60" />
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="h-10 border-b border-border bg-bg-subtle" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-4 last:border-0">
            <div className="h-3.5 w-1/3 rounded bg-elevated" />
            <div className="h-3.5 w-1/6 rounded bg-panel-2" />
            <div className="ml-auto h-3.5 w-16 rounded bg-panel-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
