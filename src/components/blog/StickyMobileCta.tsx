'use client';

import { useEffect, useState } from 'react';

interface Props {
  priceKrw?: number | null;
  productUrl?: string | null;
  groupInquiryUrl?: string | null;
  kakaoUrl?: string;
  packageId?: string | null;
  intent?: string | null;
  placement?: string;
  contextSummary?: string | null;
}

export default function StickyMobileCta({
  priceKrw,
  productUrl,
  groupInquiryUrl,
  kakaoUrl = 'https://pf.kakao.com/_xcFxkBG/chat',
  packageId,
  intent,
  placement = 'sticky_mobile_cta',
  contextSummary,
}: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 200);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const primaryUrl = productUrl || groupInquiryUrl;
  if (!primaryUrl) return null;

  const priceKr = typeof priceKrw === 'number' && priceKrw > 0
    ? `${Math.round(priceKrw / 10000).toLocaleString()}만원~`
    : null;
  const summaryId = 'blog-sticky-cta-handoff-summary';
  const isProductPrimary = Boolean(productUrl);

  return (
    <div
      className={`lg:hidden fixed left-0 right-0 bottom-0 z-40 transition-transform duration-300 ${
        visible ? 'translate-y-0' : 'translate-y-full'
      }`}
      role="complementary"
      aria-label={isProductPrimary ? '예약 문의 바로가기' : '맞춤 견적 문의 바로가기'}
    >
      <div className="border-t border-slate-200 bg-white/95 shadow-2xl backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-screen-sm mx-auto px-3 pt-2">
          <p
            id={summaryId}
            data-testid="blog-sticky-cta-handoff-summary"
            className="truncate text-[11px] font-semibold text-slate-500"
          >
            {contextSummary || '읽은 글 맥락을 상담에 함께 전달합니다.'}
          </p>
        </div>
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
            data-blog-cta="true"
            data-blog-cta-placement={`${placement}:kakao`}
            data-testid="blog-sticky-kakao"
            aria-describedby={summaryId}
            className="flex-shrink-0 px-3 py-2 bg-yellow-300 text-slate-900 text-[12px] font-bold rounded-lg"
          >
            상담
          </a>
          <a
            href={primaryUrl}
            data-blog-cta="true"
            data-blog-cta-placement={`${placement}:${isProductPrimary ? 'product' : 'group_inquiry'}`}
            data-blog-product-id={isProductPrimary ? packageId ?? undefined : undefined}
            data-recommendation-source="blog"
            data-recommendation-rank="1"
            data-recommendation-placement={placement}
            data-blog-intent={intent ?? undefined}
            data-testid="blog-sticky-primary-cta"
            aria-describedby={summaryId}
            className="flex-1 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-[13px] font-bold rounded-lg text-center"
          >
            {isProductPrimary ? '예약 문의' : '맞춤 견적'}
          </a>
        </div>
      </div>
    </div>
  );
}
