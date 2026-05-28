export default function MileagePageLoading() {
  return (
    <div className="min-h-screen bg-gray-50 animate-pulse">
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between sticky top-0 z-20">
        <div className="w-8 h-8 rounded-full bg-gray-200" />
        <div className="h-5 w-36 rounded bg-gray-200" />
        <div className="w-8" />
      </header>

      <div className="max-w-xl mx-auto px-4 py-5 space-y-5 pb-20">
        {/* 등급 카드 */}
        <div className="rounded-2xl bg-gradient-to-br from-blue-100 to-blue-50 p-5 space-y-4">
          <div className="space-y-1.5">
            <div className="h-3 w-20 rounded bg-white/50" />
            <div className="h-8 w-32 rounded bg-white/50" />
          </div>
          <div className="flex gap-2">
            <div className="h-6 w-16 rounded-full bg-white/40" />
            <div className="h-6 w-16 rounded-full bg-white/40" />
          </div>
        </div>

        {/* 요약 통계 */}
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl p-4 border border-gray-100 space-y-2">
              <div className="h-3 w-12 rounded bg-gray-200" />
              <div className="h-6 w-20 rounded bg-blue-100" />
            </div>
          ))}
        </div>

        {/* 진행바 */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
          <div className="h-4 w-40 rounded bg-gray-200" />
          <div className="h-2.5 rounded-full bg-gray-100" />
          <div className="h-3 w-48 rounded bg-gray-200" />
        </div>

        {/* 필터 탭 */}
        <div className="flex gap-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-8 w-16 rounded-lg bg-gray-200" />
          ))}
        </div>

        {/* 거래 내역 */}
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-white rounded-xl p-4 border border-gray-100 space-y-2">
            <div className="flex justify-between">
              <div className="h-4 w-32 rounded bg-gray-200" />
              <div className="h-4 w-20 rounded bg-gray-200" />
            </div>
            <div className="h-3 w-48 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
