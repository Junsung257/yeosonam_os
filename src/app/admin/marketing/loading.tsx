export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center gap-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-9 bg-admin-surface-2 rounded w-20" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-admin-md border border-admin-border shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
          <div className="h-4 bg-admin-surface-2 rounded w-32 mb-4" />
          <div className="h-[240px] bg-admin-bg rounded" />
        </div>
        <div className="bg-white rounded-admin-md border border-admin-border shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
          <div className="h-4 bg-admin-surface-2 rounded w-24 mb-4" />
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 bg-admin-bg rounded" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
