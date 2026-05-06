export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-5 bg-slate-100 rounded w-28" />
        <div className="flex gap-2">
          <div className="h-8 bg-slate-100 rounded w-28" />
          <div className="h-8 bg-slate-100 rounded w-20" />
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
        <div className="h-10 bg-slate-50 border-b border-slate-100" />
        {[...Array(8)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-slate-50">
            <div className="h-4 bg-slate-100 rounded w-16" />
            <div className="h-4 bg-slate-100 rounded flex-1" />
            <div className="h-4 bg-slate-100 rounded w-20" />
            <div className="h-4 bg-slate-100 rounded w-24" />
            <div className="h-5 bg-slate-100 rounded-full w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}
