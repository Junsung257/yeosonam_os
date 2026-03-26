'use client';

/**
 * 여소남 OS — 예약 안내문 (공통)
 * 모든 상품에 공통 적용되는 예약 규정 안내문
 * A4 1페이지 규격
 */

const PAGE_STYLE: React.CSSProperties = {
  width: '800px',
  aspectRatio: '210/297',
  background: 'white',
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box' as const,
};

export default function BookingGuideTemplate() {
  return (
    <div className="flex flex-col items-center gap-10">
      <article className="a4-export-page" style={PAGE_STYLE}>
        {/* 헤더 */}
        <header className="w-full pt-8 pb-4 px-10 border-b-2 border-[#001f3f]">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="여소남" className="h-10 object-contain shrink-0" />
            <div>
              <h1 className="text-2xl font-extrabold text-[#001f3f] tracking-tight">여소남 예약 안내문</h1>
              <p className="text-[11px] text-slate-500 mt-0.5">YEOSONAM BOOKING GUIDE</p>
            </div>
          </div>
        </header>

        {/* 본문 */}
        <main className="flex-1 px-10 py-6 text-[#0b1c30]">
          {/* 상단 안내 */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-5">
            <p className="text-[13px] font-bold text-blue-900 mb-1">📋 본 안내문은 모든 여소남 여행상품에 공통 적용됩니다.</p>
            <p className="text-[11px] text-blue-700">상품별 세부 규정(취소수수료율, 써차지, 싱글차지 금액 등)은 상품 일정표를 참고하시기 바랍니다.</p>
          </div>

          {/* 2단 레이아웃 */}
          <div className="grid grid-cols-2 gap-4">
            {/* 좌측: 예약/결제 */}
            <section>
              <h2 className="text-[14px] font-extrabold text-[#001f3f] mb-3 pb-1 border-b border-slate-200">💳 예약 및 결제 규정</h2>
              <div className="space-y-2 text-[11px] text-slate-700 leading-relaxed">
                <div className="flex gap-2 items-start">
                  <span className="shrink-0 text-red-500 font-bold">①</span>
                  <p>예약금 입금 확인 후 예약이 확정되며, 미입금 시 <span className="font-bold text-red-600">자동 취소</span> 처리됩니다.</p>
                </div>
                <div className="flex gap-2 items-start">
                  <span className="shrink-0 text-red-500 font-bold">②</span>
                  <p>출발 <span className="font-bold">1주일 전 전체 금액 완납</span>을 기준으로 하며, 특가 상품은 <span className="font-bold">2주 전 완납</span>이 필요합니다.</p>
                </div>
                <div className="flex gap-2 items-start">
                  <span className="shrink-0 text-red-500 font-bold">③</span>
                  <p>파이널 확정된 금액은 확인 날짜까지 <span className="font-bold">100% 입금</span> 필수이며, 확정 후 취소 시 <span className="font-bold text-red-600">100% 취소 위약금</span>이 발생합니다.</p>
                </div>
                <div className="flex gap-2 items-start">
                  <span className="shrink-0 text-red-500 font-bold">④</span>
                  <p>예약 인원과 출발 인원이 다를 경우 <span className="font-bold">최종 출발 인원 기준</span>으로 요금을 지불하셔야 합니다.</p>
                </div>
                <div className="flex gap-2 items-start">
                  <span className="shrink-0 text-red-500 font-bold">⑤</span>
                  <p>취소자는 취소수수료 규정대로 수수료가 발생되며, 나머지 인원도 <span className="font-bold">추가 금액이 발생</span>할 수 있습니다.</p>
                </div>
              </div>
            </section>

            {/* 우측: 취소/환불 */}
            <section>
              <h2 className="text-[14px] font-extrabold text-[#001f3f] mb-3 pb-1 border-b border-slate-200">🚫 취소 및 환불 규정</h2>
              <div className="space-y-2 text-[11px] text-slate-700 leading-relaxed">
                <div className="bg-red-50 border border-red-200 rounded p-3">
                  <p className="font-bold text-red-800 mb-1">⚠️ 특별약관 적용 상품</p>
                  <p className="text-red-700">본 행사는 <span className="font-bold">특별약관이 적용</span>되며, 취소 시 상품별 특별약관에 따른 취소수수료가 부과됩니다. 상세 취소수수료율은 상품 일정표를 참고하시기 바랍니다.</p>
                </div>
                <div className="flex gap-2 items-start">
                  <span className="shrink-0 text-slate-500 font-bold">•</span>
                  <p>취소 문의는 <span className="font-bold">평일 09시~18시</span>까지 상담 가능하며, 공휴일(토/일) 및 국가 지정 휴무일에는 취소 처리가 되지 않습니다.</p>
                </div>
                <div className="flex gap-2 items-start">
                  <span className="shrink-0 text-slate-500 font-bold">•</span>
                  <p>업무 종료시간인 <span className="font-bold">18시 이후 취소 시 익일</span>로 계산됩니다.</p>
                </div>
              </div>
            </section>
          </div>

          {/* 하단: 공통 필수 안내 */}
          <div className="grid grid-cols-2 gap-4 mt-4">
            {/* 좌측: 여행 필수 안내 */}
            <section>
              <h2 className="text-[14px] font-extrabold text-[#001f3f] mb-3 pb-1 border-b border-slate-200">🛂 여행 필수 안내</h2>
              <div className="space-y-1.5 text-[11px] text-slate-700 leading-relaxed">
                <div className="flex gap-2 items-start">
                  <span className="shrink-0">🛂</span>
                  <p>여권 유효기간은 출발일 기준 <span className="font-bold text-red-600">6개월 이상</span> 남아 있어야 합니다. 여권 만료로 인한 출국 불가 시 여행사는 책임지지 않습니다.</p>
                </div>
                <div className="flex gap-2 items-start">
                  <span className="shrink-0">👶</span>
                  <p>만 15세 미만 미성년자 입국 시 <span className="font-bold">영문 가족관계증명서</span> 등 추가 서류가 필요할 수 있습니다. (국가별 상이)</p>
                </div>
                <div className="flex gap-2 items-start">
                  <span className="shrink-0">🚭</span>
                  <p>대부분의 동남아 국가에서 <span className="font-bold text-red-600">전자담배 반입이 금지</span>되어 있으며, 위반 시 벌금이 부과됩니다.</p>
                </div>
                <div className="flex gap-2 items-start">
                  <span className="shrink-0">📱</span>
                  <p>일부 국가는 <span className="font-bold">디지털 입국카드(TDAC, 이트래블 등)</span> 사전 작성이 필수입니다. 출발 전 반드시 확인하시기 바랍니다.</p>
                </div>
              </div>
            </section>

            {/* 우측: 일반 안내 */}
            <section>
              <h2 className="text-[14px] font-extrabold text-[#001f3f] mb-3 pb-1 border-b border-slate-200">ℹ️ 일반 안내사항</h2>
              <div className="space-y-1.5 text-[11px] text-slate-700 leading-relaxed">
                <div className="flex gap-2 items-start">
                  <span className="shrink-0">🚫</span>
                  <p>본 상품은 <span className="font-bold">단체관광 목적의 패키지 상품</span>입니다. 개별 일정(친지 방문, 미계약 업체 조인 등)은 불가하며, 개별 일정 진행 시 포함된 식사/특전/샌딩 서비스가 제공되지 않습니다.</p>
                </div>
                <div className="flex gap-2 items-start">
                  <span className="shrink-0">⚠️</span>
                  <p>일정 미참여 시 <span className="font-bold">패널티가 부과</span>됩니다. (금액은 상품별 상이)</p>
                </div>
                <div className="flex gap-2 items-start">
                  <span className="shrink-0">🧾</span>
                  <p>현금영수증은 항공요금(항공사)+행사비(랜드사)로 나누어 발급되며, <span className="font-bold">행사 완료 후 5일 이내</span>에만 발급 가능합니다.</p>
                </div>
                <div className="flex gap-2 items-start">
                  <span className="shrink-0">🏨</span>
                  <p>호텔은 부득이한 경우 <span className="font-bold">동급의 다른 호텔</span>로 변경될 수 있습니다. 1인실 사용 시 싱글차지가 추가됩니다. (금액은 상품별 상이)</p>
                </div>
                <div className="flex gap-2 items-start">
                  <span className="shrink-0">📋</span>
                  <p>상기 일정은 현지 사정 또는 천재지변으로 인해 <span className="font-bold">변경될 수 있습니다.</span></p>
                </div>
              </div>
            </section>
          </div>
        </main>

        {/* 푸터 */}
        <footer className="w-full bg-[#001f3f] py-4 px-10 mt-auto">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-white font-bold text-[12px]">여소남 여행사 (YEOSONAM TRAVEL)</p>
              <p className="text-blue-200 text-[10px] mt-0.5">본 안내문을 확인하시고 동의하신 후 예약을 진행해 주시기 바랍니다.</p>
            </div>
            <p className="text-blue-300 text-[9px]">© 2024 YEOSONAM. ALL RIGHTS RESERVED.</p>
          </div>
        </footer>
      </article>
    </div>
  );
}
