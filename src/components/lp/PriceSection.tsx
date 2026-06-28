'use client';

import { useRef, useState } from 'react';
import { Download, Info } from 'lucide-react';
import type { PriceListItem, PriceRule } from '@/lib/parser';

const BADGE_STYLES: Record<string, string> = {
  특가: 'bg-red-500 text-white',
  긴급: 'bg-red-500 text-white',
  일반: 'bg-blue-500 text-white',
  호텔UP: 'bg-orange-500 text-white',
  별도문의: 'bg-amber-500 text-white',
  확정: 'bg-green-500 text-white',
  마감: 'bg-gray-400 text-white',
  soldout: 'bg-gray-400 text-white',
};

function badgeClass(badge?: string | null): string {
  if (!badge) return '';
  return BADGE_STYLES[badge] ?? 'bg-gray-300 text-gray-700';
}

function RuleRow({ rule }: { rule: PriceRule }) {
  const isInquiry = rule.price === null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1 text-sm leading-snug text-gray-700">{rule.condition}</span>
      <div className="flex shrink-0 items-center gap-2">
        {rule.badge && (
          <span
            className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${badgeClass(rule.badge)}`}
          >
            {rule.badge}
          </span>
        )}
        <span
          className={`whitespace-nowrap text-sm font-semibold tabular-nums ${
            isInquiry ? 'text-amber-600' : 'text-gray-900'
          }`}
        >
          {rule.price_text}
        </span>
      </div>
    </div>
  );
}

function PeriodCard({ item }: { item: PriceListItem }) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-gray-200 shadow-sm"
      style={{ breakInside: 'avoid' }}
    >
      <div className="bg-blue-600 px-4 py-2.5 text-white">
        <span className="text-sm font-bold tracking-wide">{item.period}</span>
      </div>

      <div className="divide-y divide-gray-50 bg-white">
        {item.rules.map((rule, index) => (
          <RuleRow key={`${rule.condition}-${index}`} rule={rule} />
        ))}
      </div>

      {item.notes && (
        <div className="flex items-start gap-2 border-t border-amber-100 bg-amber-50 px-4 py-2">
          <Info size={13} className="mt-0.5 shrink-0 text-amber-500" />
          <p className="text-xs leading-relaxed text-amber-800">{item.notes}</p>
        </div>
      )}
    </div>
  );
}

interface PriceSectionProps {
  title?: string;
  destination?: string;
  priceList: PriceListItem[];
  singleSupplement?: string;
  guideTrip?: string;
  className?: string;
}

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

  if (!priceList || priceList.length === 0) {
    return (
      <section className={`border-t border-gray-100 bg-white px-5 py-6 ${className ?? ''}`}>
        <p className="py-4 text-center text-sm text-gray-400">요금 정보가 없습니다.</p>
      </section>
    );
  }

  const handleExport = async () => {
    if (!printRef.current || exporting) return;
    setExporting(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      await document.fonts.ready;
      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        width: 794,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `${title ?? destination ?? '요금표'}_가격표.jpg`;
      link.click();
    } catch (error) {
      console.error('[PriceSectionCard] export failed:', error);
      alert('이미지 내보내기에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className={`relative mt-2 border-t border-gray-100 bg-white ${className ?? ''}`}>
      <div
        ref={printRef}
        className="mx-auto w-full max-w-[794px] bg-white px-8 py-10"
        style={{ fontFamily: "'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" }}
      >
        <div className="mb-7 flex items-start justify-between border-b-2 border-gray-100 pb-5">
          <div>
            {title && (
              <h2 className="text-xl font-extrabold leading-snug text-gray-900">{title}</h2>
            )}
            {destination && (
              <p className="mt-0.5 text-sm text-gray-500">{destination}</p>
            )}
          </div>
          <div className="ml-4 shrink-0 text-right">
            <span className="text-xs font-extrabold uppercase tracking-widest text-blue-600">
              여소남 요금표
            </span>
            <p className="mt-0.5 text-xs text-gray-400">1인 기준 · 유류할증료 포함</p>
          </div>
        </div>

        <div className="space-y-4">
          {priceList.map((item, index) => (
            <PeriodCard key={`${item.period}-${index}`} item={item} />
          ))}
        </div>

        {(singleSupplement || guideTrip) && (
          <div className="mt-6 space-y-1 rounded-xl border border-gray-200 bg-gray-50 p-3.5">
            {singleSupplement && (
              <p className="text-xs text-gray-600">
                <span className="font-semibold text-gray-700">싱글차지:</span> {singleSupplement}
              </p>
            )}
            {guideTrip && (
              <p className="text-xs text-gray-600">
                <span className="font-semibold text-gray-700">가이드/기사 경비:</span> {guideTrip}
              </p>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handleExport}
        disabled={exporting}
        aria-label="요금표 JPG 저장"
        title="A4 요금표 다운로드 (JPG)"
        className={`fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-xl transition-all duration-200 active:scale-95 ${
          exporting
            ? 'cursor-not-allowed bg-blue-400'
            : 'cursor-pointer bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {exporting ? (
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : (
          <Download className="h-6 w-6 text-white" />
        )}
      </button>
    </section>
  );
}
