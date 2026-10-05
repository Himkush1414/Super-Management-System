/** Order detail skeleton — same grid as the page, so nothing jumps when it lands. */
export default function OrderLoading() {
  return (
    <div aria-busy="true" aria-label="Loading order" className="animate-pulse">
      <div className="mb-4 h-3.5 w-16 rounded bg-panel-2" />
      <div className="mb-6 space-y-2">
        <div className="h-6 w-64 max-w-full rounded-md bg-elevated" />
        <div className="h-3.5 w-48 rounded bg-panel-2" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="h-56 rounded-xl border border-border bg-panel/60" />
          <div className="h-72 rounded-xl border border-border bg-panel/60" />
        </div>
        <div className="space-y-5">
          <div className="h-32 rounded-xl border border-border bg-panel/60" />
          <div className="h-48 rounded-xl border border-border bg-panel/60" />
        </div>
      </div>
    </div>
  );
}
