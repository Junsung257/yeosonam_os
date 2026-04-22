import Image from 'next/image';

/**
 * 상품 블로그 광고 랜딩 Hero
 *
 * 2026 CRO 베스트 프랙티스 준수:
 *  - Above-fold 가격 + CTA 2개 + Trust 배지 한 화면
 *  - H1 = 키워드 매칭형 (DKI 결과 반영)
 *  - First-person CTA ("내 패키지 확인하기" — Apexure 2026 +14%)
 *  - Hero 이미지 priority + fetchpriority="high" (LCP 최적화)
 */

interface Props {
  headline: string;                  // DKI-resolved H1
  subtitle?: string;                 // 핵심 셀링 3줄 (• 구분)
  heroImage?: string | null;
  priceKrw?: number | null;          // 최저가
  productUrl?: string | null;        // 예약/상세 페이지
  trustBadges?: string[];            // 예: ['운영팀 검증', '노팁·노옵션', '직항']
  matched?: boolean;                 // DKI 매칭 성공 시 시각 구분
}

export default function LandingHero({
  headline,
  subtitle,
  heroImage,
  priceKrw,
  productUrl,
  trustBadges = [],
  matched,
}: Props) {
  const priceKr = typeof priceKrw === 'number' && priceKrw > 0
    ? `${Math.round(priceKrw / 10000).toLocaleString()}만원~`
    : null;

  return (
    <section className="relative overflow-hidden rounded-2xl shadow-sm mb-6 bg-slate-900">
      {/* Hero 이미지 (LCP 최적화) */}
      {heroImage && (
        <div className="absolute inset-0 z-0">
          <Image
            src={heroImage}
            alt={headline}
            fill
            priority
            sizes="(max-width: 768px) 100vw, 800px"
            className="object-cover"
            fetchPriority="high"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/50 to-slate-900/20" />
        </div>
      )}

      <div className="relative z-10 px-6 py-10 md:px-10 md:py-14 text-white">
        {/* DKI 매칭 시 시그널 (디버그용 — 광고 트래픽에서만 보임) */}
        {matched && (
          <div className="inline-block mb-3 px-2 py-0.5 bg-amber-400/20 border border-amber-300/40 text-amber-200 text-[10px] rounded">
            맞춤 검색 결과
          </div>
        )}

        {/* H1 (DKI 반영) */}
        <h1 className="text-2xl md:text-4xl font-extrabold leading-tight mb-3 tracking-tight">
          {headline}
        </h1>

        {/* 부제 — 핵심 셀링 3줄 */}
        {subtitle && (
          <p className="text-base md:text-lg text-slate-200 mb-5 leading-relaxed max-w-2xl whitespace-pre-wrap">
            {subtitle}
          </p>
        )}

        {/* 가격 + CTA (1인칭, 2026 베스트 프랙티스) */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
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
          <a
            href="https://pf.kakao.com/_yeosonam"
            target="_blank"
            rel="noopener"
            className="px-4 py-2.5 bg-white/10 hover:bg-white/20 border border-white/30 text-white font-semibold text-[13px] md:text-[14px] rounded-lg backdrop-blur-sm transition"
          >
            💬 카톡 상담
          </a>
        </div>

        {/* Trust 배지 (Social proof above-fold = +12% 전환) */}
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
