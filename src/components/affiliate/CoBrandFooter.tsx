/**
 * 어필리에이터 + 여소남 Co-branding 푸터
 *
 * 사용처:
 *   - 카드뉴스 마지막 슬라이드 (선택)
 *   - 블로그 본문 footer
 *   - A4 PDF 하단
 *   - DetailClient (어필리에이터 ?ref=... 유입 시)
 *
 * 강제:
 *   - 발행자 라벨: "{affiliate.name} × 여소남"
 *   - 공정위 추천·보증 심사지침 워터마크 (ad_disclosure)
 *   - share_url CTA 버튼
 *
 * 데이터 소스: render-contract.ts 의 CanonicalView.affiliateView 그대로 소비.
 */

import type { AffiliateCoBrand } from '@/lib/render-contract';

interface Props {
  affiliate: AffiliateCoBrand;
  /** 'compact' = 1줄 푸터 (모바일/블로그 인라인) | 'full' = 카드 (A4 / 블로그 footer) */
  variant?: 'compact' | 'full';
  className?: string;
}

export function CoBrandFooter({ affiliate, variant = 'full', className = '' }: Props) {
  if (variant === 'compact') {
    return (
      <div className={`text-[11px] text-slate-500 flex items-center gap-2 ${className}`}>
        <span className="font-medium">{affiliate.affiliate_name}</span>
        <span className="text-slate-300">×</span>
        <span className="font-bold text-blue-600">{affiliate.brand_name}</span>
        <span className="ml-auto text-amber-600 font-medium">{affiliate.ad_disclosure}</span>
      </div>
    );
  }

  return (
    <div className={`border-t border-slate-200 mt-6 pt-4 space-y-3 ${className}`}>
      {/* 광고 표시 (공정위 의무) */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-800 font-medium">
        ⓘ {affiliate.ad_disclosure}
      </div>

      <div className="flex items-center gap-3">
        {affiliate.affiliate_logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={affiliate.affiliate_logo_url}
            alt={affiliate.affiliate_name}
            className="w-10 h-10 rounded-full object-cover bg-slate-100"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">
            {affiliate.affiliate_name?.[0] || '?'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-500">발행</p>
          <p className="text-sm font-bold text-slate-900 truncate">
            {affiliate.affiliate_name}
            <span className="text-slate-300 mx-2">×</span>
            <span className="text-blue-600">{affiliate.brand_name}</span>
          </p>
          {affiliate.affiliate_channel_url && (
            <a
              href={affiliate.affiliate_channel_url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-[11px] text-slate-400 hover:text-blue-600 truncate block"
            >
              {affiliate.affiliate_channel_url}
            </a>
          )}
        </div>
        <a
          href={affiliate.share_url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 px-3 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition-colors"
        >
          예약 / 자세히 보기 →
        </a>
      </div>
    </div>
  );
}

export default CoBrandFooter;
