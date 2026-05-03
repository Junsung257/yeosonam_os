export default function Loading() {
  return (
    <div className="min-h-screen bg-white max-w-lg md:max-w-3xl mx-auto animate-pulse pb-24">
      {/* 네비 스켈레톤 */}
      <div className="h-14 md:h-16 bg-white border-b border-[#F2F4F6]" />

      {/* 히어로 이미지 */}
      <div className="h-[380px] md:h-[520px] w-full bg-[#EBF3FE]" />

      {/* 신뢰 배너 */}
      <div className="h-7 bg-[#EBF3FE]" />

      {/* 상품 정보 카드 */}
      <div className="px-4 -mt-6 relative z-10">
        <div className="bg-white rounded-2xl p-5 shadow-lg border border-gray-100 space-y-3">
          {/* 목적지 배지 */}
          <div className="h-4 bg-[#F2F4F6] rounded-full w-16" />
          {/* 상품명 */}
          <div className="h-8 bg-[#DBEAFE] rounded-lg w-52" />
          <div className="h-6 bg-[#DBEAFE]/50 rounded-lg w-40" />
          {/* 하이라이트 칩 */}
          <div className="flex gap-2 pt-1">
            {[80, 96, 72, 80].map((w, i) => (
              <div key={i} className="h-6 bg-[#EBF3FE] rounded-full shrink-0" style={{ width: w }} />
            ))}
          </div>
        </div>
      </div>

      {/* 탭 바 */}
      <div className="flex border-b border-[#F2F4F6] mt-5 px-4 gap-4">
        {[52, 40, 40, 52, 52].map((w, i) => (
          <div key={i} className="h-10 bg-[#F2F4F6] rounded-md mb-0" style={{ width: w }} />
        ))}
      </div>

      {/* 섹션 콘텐츠 */}
      <div className="px-4 py-6 space-y-5">
        {/* 가격 테이블 행 */}
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-[#F2F4F6] p-4 flex items-center justify-between">
            <div className="space-y-1.5 flex-1">
              <div className="h-3.5 bg-[#F2F4F6] rounded" style={{ width: `${[60, 75, 65][i]}%` }} />
              <div className="h-3 bg-[#F2F4F6] rounded" style={{ width: `${[45, 55, 50][i]}%` }} />
            </div>
            <div className="h-6 bg-[#DBEAFE] rounded-lg w-20 shrink-0 ml-4" />
          </div>
        ))}

        {/* 일정 블록 */}
        <div className="space-y-3 pt-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-4 bg-[#DBEAFE]/80 rounded w-24" />
              <div className="h-3 bg-[#F2F4F6] rounded" style={{ width: `${[88, 72, 80, 65][i]}%` }} />
              <div className="h-3 bg-[#F2F4F6] rounded" style={{ width: `${[65, 85, 60, 75][i]}%` }} />
            </div>
          ))}
        </div>
      </div>

      {/* 하단 고정 액션 바 */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-4 pb-5 pt-3 flex gap-2 max-w-lg md:max-w-3xl mx-auto">
        <div className="flex-1 h-11 bg-[#F2F4F6] rounded-full" />
        <div className="h-11 w-20 bg-[#FEE500]/50 rounded-full shrink-0" />
        <div className="h-11 w-28 bg-[#DBEAFE] rounded-full shrink-0" />
      </div>
    </div>
  );
}
