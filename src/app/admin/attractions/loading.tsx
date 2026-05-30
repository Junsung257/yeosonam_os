export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-5 bg-admin-surface-2 rounded w-28" />
        <div className="flex gap-2">
          <div className="h-8 bg-admin-surface-2 rounded w-24" />
          <div className="h-8 bg-admin-surface-2 rounded w-24" />
          <div className="h-8 bg-admin-surface-2 rounded w-20" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {[...Array(9)].map((_, i) => (
          <div key={i} className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4">
            <div className="h-32 bg-admin-bg rounded mb-3" />
            <div className="h-4 bg-admin-surface-2 rounded w-3/4 mb-2" />
            <div className="h-3 bg-admin-surface-2 rounded w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
