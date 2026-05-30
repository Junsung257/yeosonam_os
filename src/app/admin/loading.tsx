export default function AdminLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* KPI 카드 2열 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4">
          <div className="h-3 bg-admin-surface-2 rounded w-24 mb-3" />
          <div className="h-8 bg-admin-surface-2 rounded w-32" />
        </div>
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4">
          <div className="h-3 bg-admin-surface-2 rounded w-24 mb-3" />
          <div className="h-8 bg-admin-surface-2 rounded w-32" />
        </div>
      </div>
      {/* 재무 미니카드 4열 */}
      <div className="grid grid-cols-4 gap-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-3">
            <div className="h-2.5 bg-admin-surface-2 rounded w-12 mb-2" />
            <div className="h-5 bg-admin-surface-2 rounded w-20" />
          </div>
        ))}
      </div>
      {/* 차트 영역 */}
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4">
        <div className="h-4 bg-admin-surface-2 rounded w-40 mb-3" />
        <div className="h-[200px] bg-admin-bg rounded" />
      </div>
      {/* 2열 카드 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4">
          <div className="h-4 bg-admin-surface-2 rounded w-28 mb-3" />
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 bg-admin-bg rounded" />
            ))}
          </div>
        </div>
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4">
          <div className="h-4 bg-admin-surface-2 rounded w-28 mb-3" />
          <div className="h-[120px] bg-admin-bg rounded" />
        </div>
      </div>
    </div>
  );
}
