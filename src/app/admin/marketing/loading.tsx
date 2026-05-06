export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center gap-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-9 bg-slate-100 rounded w-20" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
          <div className="h-4 bg-slate-100 rounded w-32 mb-4" />
          <div className="h-[240px] bg-slate-50 rounded" />
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
          <div className="h-4 bg-slate-100 rounded w-24 mb-4" />
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 bg-slate-50 rounded" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
