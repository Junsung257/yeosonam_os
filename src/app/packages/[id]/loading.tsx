export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="animate-pulse">
        {/* 히어로 이미지 */}
        <div className="h-56 bg-slate-200" />
        {/* 상품 기본 정보 */}
        <div className="px-4 py-4 space-y-3">
          <div className="h-6 bg-slate-100 rounded w-3/4" />
          <div className="h-4 bg-slate-100 rounded w-1/2" />
          <div className="flex gap-2 mt-2">
            <div className="h-8 bg-slate-100 rounded-full w-20" />
            <div className="h-8 bg-slate-100 rounded-full w-20" />
            <div className="h-8 bg-slate-100 rounded-full w-20" />
          </div>
        </div>
        {/* 가격 카드 */}
        <div className="px-4">
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-2">
            <div className="h-4 bg-slate-100 rounded w-20" />
            <div className="h-8 bg-slate-100 rounded w-32" />
          </div>
        </div>
        {/* 일정 */}
        <div className="px-4 mt-4 space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4">
              <div className="h-4 bg-slate-100 rounded w-24 mb-3" />
              <div className="space-y-2">
                <div className="h-3 bg-slate-50 rounded w-full" />
                <div className="h-3 bg-slate-50 rounded w-5/6" />
                <div className="h-3 bg-slate-50 rounded w-4/6" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
