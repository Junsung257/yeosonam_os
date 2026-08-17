import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';

/**
 * 상품 블로그 광고 랜딩 Hero
 *
 * 2026 CRO 베스트 프랙티스 준수:
 *  - Above-fold 가격 + CTA + persisted package fact labels
 *  - Canonical page H1은 상위 상세 페이지에서 한 번만 렌더링
 *  - Hero 이미지 priority + fetchpriority="high" (LCP 최적화)
 */

interface Props {
  subtitle?: string;                 // 핵심 셀링 3줄 (• 구분)
  heroImage?: string | null;
  priceKrw?: number | null;          // 최저가
  productUrl?: string | null;        // 예약/상세 페이지
  trustBadges?: string[];            // persisted product fact labels only
}

export default function LandingHero({
  subtitle,
  heroImage,
  priceKrw,
  productUrl,
  trustBadges = [],
}: Props) {
  const priceKr = typeof priceKrw === 'number' && priceKrw > 0
    ? `${Math.round(priceKrw / 10000).toLocaleString()}만원~`
    : null;

  return (
    <section className="relative overflow-hidden rounded-2xl shadow-sm mb-6 bg-slate-900">
      {/* Hero 이미지 — OG/외부 URL 대응 + 로드 실패 시 단색 */}
      <div className="absolute inset-0 z-0">
        <SafeCoverImg
          src={heroImage}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading="eager"
          fetchPriority="high"
          sizes="(max-width: 768px) 100vw, 896px"
          fallback={<div className="absolute inset-0 bg-slate-900" aria-hidden />}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/50 to-slate-900/20" />
      </div>

      <div className="relative z-10 px-6 py-10 md:px-10 md:py-14 text-white">
        {/* 부제 — 핵심 셀링 3줄 */}
        {subtitle && (
          <p className="text-base md:text-lg text-slate-200 mb-5 leading-relaxed max-w-2xl whitespace-pre-wrap">
            {subtitle}
          </p>
        )}

        {/* 가격 + CTA (1인칭, 2026 베스트 프랙티스) */}
        {(priceKr || productUrl) && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {priceKr && (
              <span className="text-3xl md:text-4xl font-extrabold text-amber-300 tabular-nums">
                {priceKr}
              </span>
            )}
            {productUrl && (
              <a
                href={productUrl}
                className="px-5 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-900 font-bold text-[14px] md:text-[15px] rounded-lg shadow-lg transition"
              >
                → 내 패키지 확인하기
              </a>
            )}
          </div>
        )}

        {/* Persisted package facts only; no inferred trust claims. */}
        {trustBadges.length > 0 && (
          <div className="flex flex-wrap gap-2 text-[11px] md:text-[12px] text-slate-200">
            {trustBadges.map(badge => (
              <span key={badge} className="px-2 py-0.5 bg-white/10 rounded-full border border-white/20">
                ✓ {badge}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
