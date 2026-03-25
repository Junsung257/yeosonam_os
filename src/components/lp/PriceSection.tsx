'use client';

import { useRef, useState } from 'react';
import { Download, Info } from 'lucide-react';
import type { PriceListItem, PriceRule } from '@/lib/parser';

// ─── 배지 색상 매핑 ───────────────────────────────────────────────────────────

const BADGE_STYLES: Record<string, string> = {
  '특가♥':    'bg-red-500 text-white',
  '특가':     'bg-red-500 text-white',
  '일반':     'bg-blue-500 text-white',
  '호텔UP':   'bg-orange-500 text-white',
  '별도문의':  'bg-amber-500 text-white',
  '확정':     'bg-green-500 text-white',
  '마감':     'bg-gray-400 text-white',
  'soldout':  'bg-gray-400 text-white',
};

function badgeClass(badge?: string | null): string {
  if (!badge) return '';
  return BADGE_STYLES[badge] ?? 'bg-gray-300 text-gray-700';
}

// ─── 기간 규칙 행 ────────────────────────────────────────────────────────────

function RuleRow({ rule }: { rule: PriceRule }) {
  const isInquiry = rule.price === null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="text-sm text-gray-700 flex-1 min-w-0 leading-snug">{rule.condition}</span>
      <div className="flex items-center gap-2 shrink-0">
        {rule.badge && (
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${badgeClass(rule.badge)}`}
          >
            {rule.badge}
          </span>
        )}
        <span
          className={`text-sm font-semibold whitespace-nowrap tabular-nums ${
            isInquiry ? 'text-amber-600' : 'text-gray-900'
          }`}
        >
          {rule.price_text}
        </span>
      </div>
    </div>
  );
}

// ─── 기간 카드 ──────────────────────────────────────────────────────────────

function PeriodCard({ item }: { item: PriceListItem }) {
  return (
    // break-inside-avoid — A4 페이지 경계에서 카드 짤림 방지
    <div
      className="border border-gray-200 rounded-xl overflow-hidden shadow-sm"
      style={{ breakInside: 'avoid' }}
    >
      {/* 기간 헤더 */}
      <div className="bg-blue-600 text-white px-4 py-2.5">
        <span className="font-bold text-sm tracking-wide">{item.period}</span>
      </div>

      {/* 규칙 행 목록 */}
      <div className="bg-white divide-y divide-gray-50">
        {item.rules.map((rule, i) => (
          <RuleRow key={i} rule={rule} />
        ))}
      </div>

      {/* 부가 조건 Notes bar */}
      {item.notes && (
        <div className="bg-amber-50 border-t border-amber-100 px-4 py-2 flex items-start gap-2">
          <Info size={13} className="text-amber-500 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800 leading-relaxed">{item.notes}</p>
        </div>
      )}
    </div>
  );
}

// ─── Props ─────────────────────────────────────────────────────────────────

interface PriceSectionProps {
  title?:            string;
  destination?:      string;
  priceList:         PriceListItem[];
  singleSupplement?: string;
  guideTrip?:        string;
  className?:        string;
}

// ─── 메인 컴포넌트 ──────────────────────────────────────────────────────────

export default function PriceSectionCard({
  title,
  destination,
  priceList,
  singleSupplement,
  guideTrip,
  className,
}: PriceSectionProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  // 빈 데이터 guard
  if (!priceList || priceList.length === 0) {
    return (
      <section className={`px-5 py-6 bg-white border-t border-gray-100 ${className ?? ''}`}>
        <p className="text-sm text-gray-400 text-center py-4">요금표 정보가 없습니다.</p>
      </section>
    );
  }

  // html2canvas 내보내기 — 동적 임포트 (SSR 안전)
  const handleExport = async () => {
    if (!printRef.current || exporting) return;
    setExporting(true);
    try {
      // html2canvas는 document를 참조하므로 반드시 동적 임포트
      const html2canvas = (await import('html2canvas')).default;
      // 한글 웹폰트(Noto Sans KR 등) 로딩 완료 대기
      await document.fonts.ready;
      const canvas = await html2canvas(printRef.current, {
        scale:           2,           // 2× 레티나 — 1588px wide output
        width:           794,         // A4 @96dpi 너비 강제
        useCORS:         true,        // 외부 이미지 CORS 허용
        backgroundColor: '#ffffff',
        logging:         false,
      });
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      const link    = document.createElement('a');
      link.href     = dataUrl;
      link.download = `${title ?? destination ?? '요금표'}_가격표.jpg`;
      link.click();
    } catch (err) {
      console.error('[PriceSectionCard] 내보내기 실패:', err);
      alert('이미지 내보내기에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className={`bg-white border-t border-gray-100 mt-2 relative ${className ?? ''}`}>

      {/* ── A4 캡처 영역 — FAB 버튼 밖에 위치 ────────────────────────────────── */}
      {/*  max-w-[794px] = A4 210mm @96dpi. 캡처 시 이 div만 촬영됨.               */}
      <div
        ref={printRef}
        className="w-full max-w-[794px] mx-auto bg-white px-8 py-10"
        style={{ fontFamily: "'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" }}
      >
        {/* 브로셔 헤더 */}
        <div className="flex items-start justify-between mb-7 pb-5 border-b-2 border-gray-100">
          <div>
            {title && (
              <h2 className="text-xl font-extrabold text-gray-900 leading-snug">{title}</h2>
            )}
            {destination && (
              <p className="text-sm text-gray-500 mt-0.5">{destination}</p>
            )}
          </div>
          <div className="shrink-0 ml-4 text-right">
            <span className="text-xs font-extrabold text-blue-600 tracking-widest uppercase">
              여소남 요금표
            </span>
            <p className="text-xs text-gray-400 mt-0.5">1인 기준 · 유류세 포함</p>
          </div>
        </div>

        {/* 기간 카드 목록 */}
        <div className="space-y-4">
          {priceList.map((item, idx) => (
            <PeriodCard key={idx} item={item} />
          ))}
        </div>

        {/* 하단 각주 (싱글차지 / 가이드팁) */}
        {(singleSupplement || guideTrip) && (
          <div className="mt-6 p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-1">
            {singleSupplement && (
              <p className="text-xs text-gray-600">
                <span className="font-semibold text-gray-700">싱글차지:</span> {singleSupplement}
              </p>
            )}
            {guideTrip && (
              <p className="text-xs text-gray-600">
                <span className="font-semibold text-gray-700">가이드/기사경비:</span> {guideTrip}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── FAB — printRef 외부: 캡처된 JPG에 나타나지 않음 ─────────────────── */}
      <button
        onClick={handleExport}
        disabled={exporting}
        aria-label="요금표 JPG 저장"
        title="A4 브로셔 다운로드 (JPG)"
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full
                    shadow-xl flex items-center justify-center
                    transition-all duration-200 active:scale-95
                    ${exporting
                      ? 'bg-blue-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 cursor-pointer'
                    }`}
      >
        {exporting ? (
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <Download className="w-6 h-6 text-white" />
        )}
      </button>
    </section>
  );
}
