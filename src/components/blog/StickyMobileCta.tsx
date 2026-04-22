'use client';

import { useEffect, useState } from 'react';

/**
 * 모바일 하단 Sticky CTA Bar
 *
 * 2026 CRO: +15~25% 전환 (리서치 검증)
 * - 스크롤 200px 지나면 자동 노출
 * - 가격 + 카톡 + 예약 3블록
 * - 모바일만 노출 (lg:hidden)
 */

interface Props {
  priceKrw?: number | null;
  productUrl?: string | null;
  kakaoUrl?: string;
}

export default function StickyMobileCta({
  priceKrw,
  productUrl,
  kakaoUrl = 'https://pf.kakao.com/_yeosonam',
}: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > 200);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!productUrl) return null;

  const priceKr = typeof priceKrw === 'number' && priceKrw > 0
    ? `${Math.round(priceKrw / 10000).toLocaleString()}만원~`
    : null;

  return (
    <div
      className={`lg:hidden fixed left-0 right-0 bottom-0 z-40 transition-transform duration-300 ${
        visible ? 'translate-y-0' : 'translate-y-full'
      }`}
      role="complementary"
      aria-label="예약 바로가기"
    >
      <div className="bg-white/95 backdrop-blur border-t border-slate-200 shadow-2xl">
        <div className="flex items-center gap-2 px-3 py-2.5 max-w-screen-sm mx-auto">
          {priceKr && (
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] text-slate-500">최저가</span>
              <span className="text-[15px] font-extrabold text-orange-600 tabular-nums">{priceKr}</span>
            </div>
          )}
          <a
            href={kakaoUrl}
            target="_blank"
            rel="noopener"
            className="flex-shrink-0 px-3 py-2 bg-yellow-300 text-slate-900 text-[12px] font-bold rounded-lg"
          >
            💬 상담
          </a>
          <a
            href={productUrl}
            className="flex-1 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-[13px] font-bold rounded-lg text-center"
          >
            → 예약하기
          </a>
        </div>
      </div>
    </div>
  );
}
