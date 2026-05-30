export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-5 bg-admin-surface-2 rounded w-28" />
        <div className="h-8 bg-admin-surface-2 rounded w-24" />
      </div>
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
        <div className="h-10 bg-admin-bg border-b border-admin-border" />
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-slate-50">
            <div className="h-4 bg-admin-surface-2 rounded w-20" />
            <div className="h-4 bg-admin-surface-2 rounded flex-1" />
            <div className="h-4 bg-admin-surface-2 rounded w-24" />
            <div className="h-5 bg-admin-surface-2 rounded-full w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
