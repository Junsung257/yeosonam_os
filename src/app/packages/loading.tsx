export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="animate-pulse">
        {/* 헤더 */}
        <div className="bg-gradient-to-br from-violet-600 to-purple-700 px-4 pt-12 pb-8">
          <div className="h-6 bg-white/20 rounded w-40 mx-auto mb-2" />
          <div className="h-4 bg-white/15 rounded w-56 mx-auto" />
        </div>
        {/* 상품 카드 */}
        <div className="px-4 -mt-4 space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex gap-3">
                <div className="w-24 h-20 bg-slate-100 rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-100 rounded w-3/4" />
                  <div className="h-3 bg-slate-100 rounded w-1/2" />
                  <div className="h-5 bg-slate-100 rounded w-24 mt-1" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
