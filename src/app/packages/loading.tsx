export default function Loading() {
  return (
    <div className="min-h-screen bg-white w-full max-w-lg md:max-w-none mx-auto">
      {/* 네비 스켈레톤 */}
      <div className="h-14 md:h-16 bg-white border-b border-admin-border" />

      <div className="animate-pulse">
        {/* 통합 헤더 존 스켈레톤 */}
        <div className="bg-gradient-to-b from-brand-light to-[#F5F9FF] border-b border-blue-200/50 px-4 pt-5 pb-4 md:px-8 md:pt-8 md:pb-6 md:max-w-7xl md:mx-auto">
          {/* 타이틀 */}
          <div className="h-7 bg-blue-100/80 rounded-lg w-32 mb-1.5" />
          <div className="h-4 bg-blue-100/50 rounded w-20 mb-4" />
          {/* 허브 pill 행 */}
          <div className="flex gap-2 mb-3">
            {[60, 52, 56, 52, 48].map((w, i) => (
              <div key={i} className="h-[34px] bg-white/70 rounded-full shrink-0" style={{ width: w }} />
            ))}
          </div>
          {/* 검색 카드 */}
          <div className="rounded-2xl border border-[#E5E7EB]/90 bg-white p-4 space-y-3 shadow-[0_12px_40px_rgba(49,130,246,0.08)]">
            <div className="h-11 bg-[#F8FAFC] rounded-xl" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-10 bg-[#F8FAFC] rounded-xl" />
              <div className="h-10 bg-[#F8FAFC] rounded-xl" />
            </div>
            <div className="h-12 bg-blue-100 rounded-xl" />
          </div>
        </div>

        {/* 필터 바 스켈레톤 */}
        <div className="border-b border-[#EEF2F6] px-4 py-2.5 md:px-8 flex gap-2 items-center md:max-w-7xl md:mx-auto">
          <div className="h-[34px] w-24 bg-bg-section rounded-full" />
          <div className="w-px h-4 bg-[#E5E7EB]" />
          {['전체', '일본', '중국', '동남아', '마카오·홍콩'].map((_, i) => (
            <div key={i} className="h-[34px] bg-bg-section rounded-full shrink-0" style={{ width: [44, 44, 44, 72, 88][i] }} />
          ))}
        </div>

        {/* 카드 그리드 스켈레톤 */}
        <div className="px-4 py-4 space-y-3 md:max-w-7xl md:mx-auto md:px-8 md:py-6 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-[16px] shadow-card overflow-hidden md:block flex gap-3 py-4 md:py-0 border-b border-admin-border last:border-b-0 md:border-b-0">
              <div className="w-[128px] h-[104px] md:w-full md:aspect-[4/3] md:h-auto bg-brand-light shrink-0 rounded-[12px] md:rounded-none" />
              <div className="flex-1 p-3 md:p-5 space-y-2">
                <div className="h-3 bg-bg-section rounded w-3/4" />
                <div className="h-4 bg-bg-section rounded" />
                <div className="h-4 bg-bg-section rounded w-5/6" />
                <div className="h-5 bg-blue-100 rounded w-28 mt-3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
