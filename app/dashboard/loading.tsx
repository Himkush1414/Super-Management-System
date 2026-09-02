export default function DashboardLoading() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-40 animate-pulse rounded bg-elevated" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-panel" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-panel" />
    </div>
  );
}
