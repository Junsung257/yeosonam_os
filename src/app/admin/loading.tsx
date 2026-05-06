export default function AdminLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* KPI 카드 2열 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
          <div className="h-3 bg-slate-100 rounded w-24 mb-3" />
          <div className="h-8 bg-slate-100 rounded w-32" />
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
          <div className="h-3 bg-slate-100 rounded w-24 mb-3" />
          <div className="h-8 bg-slate-100 rounded w-32" />
        </div>
      </div>
      {/* 재무 미니카드 4열 */}
      <div className="grid grid-cols-4 gap-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-3">
            <div className="h-2.5 bg-slate-100 rounded w-12 mb-2" />
            <div className="h-5 bg-slate-100 rounded w-20" />
          </div>
        ))}
      </div>
      {/* 차트 영역 */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
        <div className="h-4 bg-slate-100 rounded w-40 mb-3" />
        <div className="h-[200px] bg-slate-50 rounded" />
      </div>
      {/* 2열 카드 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
          <div className="h-4 bg-slate-100 rounded w-28 mb-3" />
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 bg-slate-50 rounded" />
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
          <div className="h-4 bg-slate-100 rounded w-28 mb-3" />
          <div className="h-[120px] bg-slate-50 rounded" />
        </div>
      </div>
    </div>
  );
}
