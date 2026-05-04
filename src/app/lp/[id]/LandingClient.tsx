'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';
import { useSearchParams } from 'next/navigation';
import {
  ShieldCheck, Award, Phone, Flame, MapPin, Star,
  MessageCircle, Clock,
} from 'lucide-react';
import { useTracking } from '@/hooks/useTracking';
import { submitLeadPipeline } from '@/lib/submitPipeline';
import { useChatStore } from '@/lib/chat-store';
import { trackViewContent, trackLead } from '@/components/MetaPixel';
import { trackKakaoViewContent } from '@/lib/kakao-moment-events';
import { openKakaoChannel } from '@/lib/kakaoChannel';
import { sanitizeUtmTermForDisplay } from '@/lib/sanitize-ad-copy';
import type { ChannelSource, LandingProductData } from '@/lib/map-travel-package-to-lp';

const PriceSectionCard = dynamic(() => import('@/components/lp/PriceSection'));
const LeadBottomSheet = dynamic(() => import('@/components/lp/LeadBottomSheet'), { ssr: false });
const LpDeferSectionsDyn = dynamic(
  () => import('./LpDeferSections').then(m => ({ default: m.LpDeferSections })),
  {
    loading: () => (
      <div className="bg-white border-t border-gray-100 mt-2 px-5 py-8 space-y-3 animate-pulse">
        <div className="h-5 w-28 rounded bg-slate-200" />
        <div className="h-36 rounded-xl bg-slate-100" />
        <div className="h-36 rounded-xl bg-slate-100" />
        <div className="h-24 rounded-xl bg-slate-100" />
      </div>
    ),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('ko-KR');
}

// ─────────────────────────────────────────────────────────────────────────────
// 서브 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

/** 상단 고정 스캐어시티 티커 */
function ScarcityTicker({ seats, dateLabel }: { seats: number; dateLabel: string }) {
  const isUrgent = seats <= 3;
  const bgClass = isUrgent
    ? 'bg-red-600 text-white'
    : 'bg-orange-500 text-white';

  return (
    <div className={`sticky top-0 z-50 text-center py-2.5 px-4 text-sm font-bold tracking-wide ${bgClass}`}>
      <Flame className="inline w-4 h-4 mr-1 -mt-0.5" />
      {dateLabel} 출발 &nbsp;—&nbsp; 잔여 <span className="text-yellow-300 text-base">{seats}석</span> 마감 임박!
    </div>
  );
}

/** 신뢰 배지 행 — 후기 집계가 없으면 별점 칸 대신 ‘빠른 답변’ (가짜 후기 금지) */
function TrustBadges({ reviewScore, reviewCount, guaranteed, hasReviewStats }: {
  reviewScore: number; reviewCount: number; guaranteed: boolean; hasReviewStats: boolean;
}) {
  return (
    <div className="flex justify-around py-5 bg-[var(--bg-section)] border-y border-[var(--border-mid)]">
      <div className="flex flex-col items-center gap-1">
        <ShieldCheck className="w-6 h-6 text-[var(--brand)]" />
        <span className="text-sm font-semibold text-[var(--text-body)] text-center leading-tight">
          {guaranteed ? '일정 확정\n출발 표시' : '출발 확정\n일정 확인'}
        </span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <Award className="w-6 h-6 text-amber-500" />
        <span className="text-sm font-semibold text-[var(--text-body)] text-center leading-tight">직판\n최저가</span>
      </div>
      {hasReviewStats ? (
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-0.5">
            <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
            <span className="text-sm font-bold text-[var(--text-primary)]">{reviewScore.toFixed(1)}</span>
          </div>
          <span className="text-sm text-[var(--text-muted)]">{fmt(reviewCount)}건 후기</span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1">
          <Clock className="w-6 h-6 text-[var(--brand)]" />
          <span className="text-sm font-semibold text-[var(--text-body)] text-center leading-tight">빠른\n상담 응답</span>
        </div>
      )}
      <div className="flex flex-col items-center gap-1">
        <Phone className="w-6 h-6 text-[var(--success)]" />
        <span className="text-sm font-semibold text-[var(--text-body)] text-center leading-tight">24시간\n현지 지원</span>
      </div>
    </div>
  );
}

/** 가격 섹션 — compareAt 은 동일 상품 요금표 내 최고가 대비일 때만 표시 */
function PriceSection({ priceFrom, compareAtPrice, deadlineDays }: {
  priceFrom: number;
  compareAtPrice: number | null;
  deadlineDays: number | null;
}) {
  const discount =
    compareAtPrice != null && compareAtPrice > priceFrom
      ? Math.round((1 - priceFrom / compareAtPrice) * 100)
      : null;

  return (
    <section className="px-5 py-6 bg-white">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        {deadlineDays != null && deadlineDays >= 0 && deadlineDays <= 30 && (
          <span
            className={`text-xs font-bold px-2.5 py-1 rounded-full ${
              deadlineDays <= 3 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
            }`}
          >
            예약 마감 D-{deadlineDays}
          </span>
        )}
        {discount != null && discount > 0 && (
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-[var(--brand-light)] text-[var(--brand-dark)]">
            요금표 최고가 대비 {discount}%
          </span>
        )}
      </div>
      <div className="flex items-end gap-3 mt-2">
        <div>
          {compareAtPrice != null && compareAtPrice > priceFrom && (
            <p className="text-sm text-[var(--text-muted)] line-through">{fmt(compareAtPrice)}원</p>
          )}
          <p className="text-3xl font-extrabold text-[var(--text-primary)]">
            {fmt(priceFrom)}<span className="text-lg font-semibold text-[var(--text-body)]">원~</span>
          </p>
        </div>
        <p className="text-sm text-[var(--text-muted)] pb-1">1인 기준 · 유류세 포함</p>
      </div>
    </section>
  );
}

/** 하이라이트 태그 */
function Highlights({ items }: { items: string[] }) {
  return (
    <section className="px-5 py-5 bg-white border-t border-gray-100">
      <h3 className="text-base font-bold text-gray-500 uppercase tracking-wider mb-3">여행 하이라이트</h3>
      <div className="flex flex-wrap gap-2">
        {items.map(h => (
          <span key={h} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 text-sm font-medium">
            <MapPin className="w-3.5 h-3.5" /> {h}
          </span>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 (RSC가 initialData 주입 — 클라이언트는 채널·트래킹·시트만)
// ─────────────────────────────────────────────────────────────────────────────

export function LandingClient({ initialData }: { initialData: LandingProductData }) {
  const searchParams = useSearchParams();
  const source = (searchParams.get('source') ?? 'default') as ChannelSource;
  const validSource: ChannelSource = ['insta', 'kakao'].includes(source) ? source : 'default';

  const data = initialData;

  useEffect(() => {
    trackViewContent({
      content_name: data.customMessage.default.headline,
      content_category: 'travel_package_lp',
      value: data.priceFrom,
      content_ids: [data.id],
    });
    trackKakaoViewContent({
      id: data.id,
      name: data.customMessage.default.headline,
      value: data.priceFrom,
    });
  }, [data.customMessage.default.headline, data.priceFrom, data.id]);

  // ── Hooks must be called before any early return (react-hooks/rules-of-hooks) ──
  // Intersection Observer → FAB 활성화
  const { itineraryViewed, setItineraryViewed, registerScrollSentinel, getSnapshot } = useTracking();
  const handleItineraryViewed = useCallback(() => setItineraryViewed(true), [setItineraryViewed]);

  const [sheetOpen, setSheetOpen] = useState(false);

  // 스크롤 깊이 센티널 refs
  const sentinel25Ref = useRef<HTMLDivElement>(null);
  const sentinel50Ref = useRef<HTMLDivElement>(null);
  const sentinel90Ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c25 = registerScrollSentinel(sentinel25Ref.current, 25);
    const c50 = registerScrollSentinel(sentinel50Ref.current, 50);
    const c90 = registerScrollSentinel(sentinel90Ref.current, 90);
    return () => { c25?.(); c50?.(); c90?.(); };
  }, [registerScrollSentinel]);

  const msg = data.customMessage[validSource];
  const utmTerm = sanitizeUtmTermForDisplay(searchParams.get('utm_term'));

  // 채널별 히어로 스타일
  const isInsta = validSource === 'insta';
  const isKakao = validSource === 'kakao';
  const heroImage = isInsta ? data.heroImageA : data.heroImageB;

  // 채널별 FAB 텍스트 (시트 = 일정·인원·연락처 정밀 리드)
  const fabText = isInsta ? '일정·인원 입력하고 상담받기' : '일정·인원 입력하고 상담받기';

  const hasReviewStats = data.reviewCount >= 1;

  return (
    <div className="min-h-screen bg-[var(--bg-section)] text-[var(--text-primary)] max-w-[430px] mx-auto relative pb-36">

      <div className="flex justify-end px-4 py-2.5 border-b border-[var(--border-mid)] bg-white/90 backdrop-blur-sm sticky top-0 z-30">
        <Link href={`/packages/${data.id}`} className="text-xs font-semibold text-[var(--brand)] hover:underline">
          전체 일정·약관 보기
        </Link>
      </div>

      {data.scarcityRemaining != null && (
        <ScarcityTicker seats={data.scarcityRemaining} dateLabel={data.departureDateLabel} />
      )}

      {/* 스크롤 25% 센티널 */}
      <div ref={sentinel25Ref} className="absolute" style={{ top: '25%', height: 1, width: 1, pointerEvents: 'none' }} />

      {/* ── 히어로 섹션 ────────────────────────────────────────── */}
      <section className="relative overflow-hidden min-h-[240px]" style={{ height: '72vw', maxHeight: 360 }}>
        <SafeCoverImg
          src={heroImage}
          alt={data.destination}
          className="absolute inset-0 h-full w-full object-cover"
          loading="eager"
          fetchPriority="high"
          fallback={<div className="absolute inset-0 bg-gradient-to-br from-[#191F28] via-[#1B64DA] to-[#3182F6]" />}
        />
        <div
          className={`absolute inset-0 pointer-events-none ${
            isInsta
              ? 'bg-gradient-to-b from-rose-900/20 via-transparent to-gray-900/80'
              : isKakao
                ? 'bg-gradient-to-b from-blue-900/30 via-transparent to-gray-900/85'
                : 'bg-gradient-to-b from-gray-900/20 via-transparent to-gray-900/75'
          }`}
        />
        <div className="absolute bottom-0 left-0 right-0 px-5 pb-6 z-[1]">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white/20 text-white backdrop-blur-sm">
              {data.destination}
            </span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white/20 text-white backdrop-blur-sm">
              {data.duration}
            </span>
          </div>
          <h1
            className={`text-white leading-tight whitespace-pre-line drop-shadow-md ${
              isInsta
                ? 'text-2xl font-light tracking-wide'
                : isKakao
                  ? 'text-2xl font-extrabold'
                  : 'text-2xl font-bold'
            }`}
          >
            {msg.headline}
          </h1>
          <p className="text-white/80 text-sm mt-2 leading-relaxed drop-shadow-sm">
            {utmTerm ? `${utmTerm} · ${msg.subline}`.slice(0, 220) : msg.subline}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="flex-1 py-3 rounded-xl bg-[#FEE500] text-sm font-bold text-[#191F28] active:scale-[0.98] transition-transform shadow-md"
              onClick={async () => {
                trackLead({
                  content_name: data.customMessage.default.headline,
                  value: data.priceFrom,
                  content_ids: [data.id],
                });
                trackKakaoViewContent({
                  id: `lp_kakao_${data.id}`,
                  name: 'LP_카카오바로문의',
                  value: data.priceFrom,
                });
                await openKakaoChannel({
                  internalCode: data.internalCode,
                  productTitle: data.customMessage.default.headline,
                });
              }}
            >
              카카오로 바로 문의
            </button>
            <Link
              href={`/packages/${data.id}`}
              className="flex items-center justify-center px-4 py-3 rounded-xl border border-white/50 text-sm font-semibold text-white bg-black/25 backdrop-blur-md hover:bg-black/35"
            >
              상세
            </Link>
          </div>
        </div>
      </section>

      <TrustBadges
        reviewScore={data.reviewScore}
        reviewCount={data.reviewCount}
        guaranteed={data.departureGuaranteed}
        hasReviewStats={hasReviewStats}
      />

      <PriceSection
        priceFrom={data.priceFrom}
        compareAtPrice={data.compareAtPrice}
        deadlineDays={data.deadlineDays}
      />

      {/* ── 상세 요금표 (날짜/조건별 카드 UI) ──────────────────────── */}
      {data.price_list && data.price_list.length > 0 && (
        <PriceSectionCard
          title={`${data.destination} ${data.duration}`}
          destination={data.destination}
          priceList={data.price_list}
          singleSupplement={data.singleSupplement}
          guideTrip={data.guideTrip}
        />
      )}

      {/* ── 하이라이트 ──────────────────────────────────────────── */}
      <Highlights items={data.itinerary.highlights} />

      {/* 스크롤 50% 센티널 */}
      <div ref={sentinel50Ref} className="absolute" style={{ top: '50%', height: 1, width: 1, pointerEvents: 'none' }} />

      <LpDeferSectionsDyn
        days={data.itinerary.days}
        onItineraryViewed={handleItineraryViewed}
        includes={data.itinerary.includes}
        excludes={data.itinerary.excludes}
        legalNotices={data.itinerary.legalNotices}
        packageId={data.id}
        reviewScore={data.reviewScore}
        reviewCount={data.reviewCount}
      />

      {/* 스크롤 90% 센티널 */}
      <div ref={sentinel90Ref} className="h-1" />

      {/* ── 하단 여백 ───────────────────────────────────────────── */}
      <div className="h-12" />

      {/* ── 플로팅 CTA (FAB) ────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-center pb-safe-area">
        <div className="w-full max-w-[430px] px-4 pb-5 pt-3 bg-gradient-to-t from-white via-white/90 to-transparent">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className={`w-full py-4 rounded-2xl font-extrabold text-base flex items-center justify-center gap-2 transition-all duration-200
              bg-[#FEE500] text-gray-900 hover:brightness-95 active:scale-[0.98] shadow-lg
              ${itineraryViewed ? 'ring-2 ring-yellow-400/70 shadow-xl' : ''}`}
          >
            <MessageCircle className="w-5 h-5" />
            {fabText}
          </button>
          <p className="text-center text-xs text-[var(--text-muted)] mt-2">
            출발일·인원 입력 후 상담 연결 · 카카오 바로 문의는 상단 버튼
          </p>
        </div>
      </div>

      {/* ── 상담 신청 Bottom Sheet ───────────────────────────────── */}
      <LeadBottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        defaultDate={data.departureFullDate}
        priceDates={data.price_dates}
        onSubmit={async (form) => {
          await submitLeadPipeline(
            data.id,
            form,
            getSnapshot(),
            data.kakaoChannelUrl,
            {
              productTitle: data.customMessage?.default?.headline,
              internalCode: data.internalCode,
              leadValueForPixel: data.priceFrom,
            },
            useChatStore.getState().sessionId,
          );
          setSheetOpen(false);
        }}
      />
    </div>
  );
}
