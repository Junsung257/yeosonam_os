'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';
import { useSearchParams } from 'next/navigation';
import {
  ShieldCheck, Award, Phone, Flame, MapPin, Star,
  MessageCircle, Clock, Plane,
} from 'lucide-react';
import { useTracking } from '@/hooks/useTracking';
import { submitLeadPipeline } from '@/lib/submitPipeline';
import { useChatStore } from '@/lib/chat-store';
import { getSessionId } from '@/lib/tracker';
import { trackViewContent } from '@/components/MetaPixel';
import { trackKakaoViewContent } from '@/lib/kakao-moment-events';
import { openKakaoChannel } from '@/lib/kakaoChannel';
import { sanitizeUtmTermForDisplay } from '@/lib/sanitize-ad-copy';
import type { ChannelSource, LandingProductData } from '@/lib/map-travel-package-to-lp';
import type { NoticeBlock } from '@/lib/standard-terms';
import { sanitizeNoticeForCustomerSurface } from '@/lib/standard-terms-client';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { getPriceScopeLabel, getUpcomingPriceDates } from '@/lib/price-dates';
import { formatKstDate } from '@/lib/kst-date';

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
        <span className="text-sm font-semibold text-[var(--text-body)] text-center leading-tight whitespace-pre-line">
          {guaranteed ? '일정 조건\n상담 확인' : '출발일\n상담 확인'}
        </span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <Award className="w-6 h-6 text-amber-500" />
        <span className="text-sm font-semibold text-[var(--text-body)] text-center leading-tight">
          출발일별<br />가격 확인
        </span>
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
          <span className="text-sm font-semibold text-[var(--text-body)] text-center leading-tight">
            카톡<br />상담 연결
          </span>
        </div>
      )}
      <div className="flex flex-col items-center gap-1">
        <Phone className="w-6 h-6 text-[var(--success)]" />
        <span className="text-sm font-semibold text-[var(--text-body)] text-center leading-tight">
          예약 전<br />최종 확인
        </span>
      </div>
    </div>
  );
}

/** 가격 섹션 — compareAt 은 동일 상품 요금표 내 최고가 대비일 때만 표시 */
function PriceSection({ priceFrom, compareAtPrice, deadlineDays, ticketingCondition, packageId, destination, customerBudget }: {
  priceFrom: number;
  compareAtPrice: number | null;
  deadlineDays: number | null;
  ticketingCondition: LandingProductData['ticketingCondition'];
  packageId: string;
  destination: string;
  customerBudget?: LandingProductData['customerBudget'];
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const discount =
    compareAtPrice != null && compareAtPrice > priceFrom
      ? Math.round((1 - priceFrom / compareAtPrice) * 100)
      : null;

  useEffect(() => {
    const element = sectionRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.intersectionRatio < 0.5) return;
      trackAnalyticsEvent('ysn_price_view', {
        package_id: packageId,
        destination,
        price_type: priceFrom > 0 ? 'from_price' : 'inquiry',
        displayed_price: priceFrom > 0 ? priceFrom : undefined,
        currency: 'KRW',
      }, { dedupeKey: `lp:${packageId}:price` });
      observer.disconnect();
    }, { threshold: 0.5 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [destination, packageId, priceFrom]);

  return (
    <section ref={sectionRef} className="px-5 py-6 bg-white">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        {ticketingCondition?.consultationOnly ? (
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-900">
            {ticketingCondition.notice}
          </span>
        ) : deadlineDays != null && deadlineDays >= 0 && deadlineDays <= 30 ? (
          <span
            className={`text-xs font-bold px-2.5 py-1 rounded-full ${
              deadlineDays <= 3 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
            }`}
          >
            예약 마감 D-{deadlineDays}
          </span>
        ) : ticketingCondition ? (
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
            {ticketingCondition.notice}
          </span>
        ) : null}
        {discount != null && discount > 0 && (
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-[var(--brand-light)] text-[var(--brand-dark)]">
            랜드사 정상가 대비 {discount}%
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1 mt-2">
        <div>
          {compareAtPrice != null && compareAtPrice > priceFrom && (
            <p className="text-sm text-[var(--text-muted)] line-through">{fmt(compareAtPrice)}원</p>
          )}
          {priceFrom > 0 ? (
            <p className="text-3xl font-extrabold text-[var(--text-primary)]">
              {fmt(priceFrom)}<span className="text-lg font-semibold text-[var(--text-body)]">원~</span>
            </p>
          ) : (
            <p className="text-2xl font-extrabold text-[var(--text-primary)]">현재 요금 상담 확인</p>
          )}
        </div>
        <p className="text-sm text-[var(--text-muted)] pb-1">
          {customerBudget?.fuel_surcharge.status === 'included'
            ? '1인 기준 · 유류할증료 포함'
            : customerBudget?.fuel_surcharge.status === 'excluded_fixed'
              ? `1인 기준 상품가 · 유류할증료 ${fmt(customerBudget.fuel_surcharge.amount ?? 0)}원 별도`
              : customerBudget?.fuel_surcharge.status === 'excluded_unpriced'
                  || customerBudget?.fuel_surcharge.status === 'conflicting'
                ? '1인 기준 상품가 · 유류할증료 별도'
                : '1인 기준 상품가'}
        </p>
      </div>
      {priceFrom > 0
        && customerBudget?.calculation === 'base_plus_fuel'
        && customerBudget.expected_budget != null
        && customerBudget.fuel_surcharge.amount != null && (
          <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3.5 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-bold text-blue-950">예상 부담금액</p>
              <p className="text-xl font-black tabular-nums text-blue-950">
                {fmt(customerBudget.expected_budget)}원
              </p>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-blue-800">
              상품가 {fmt(customerBudget.base_product_price ?? priceFrom)}원 + 유류할증료 {fmt(customerBudget.fuel_surcharge.amount)}원
            </p>
          </div>
        )}
      {priceFrom > 0 && customerBudget?.calculation === 'fuel_confirmation_required' && (
        <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3.5 py-3">
          <p className="text-sm font-bold text-amber-950">예상 부담금액은 유류할증료 확인 후 안내됩니다.</p>
          <p className="mt-1 text-xs text-amber-800">확인되지 않은 금액을 상품가에 임의로 더하지 않습니다.</p>
        </div>
      )}
      {customerBudget?.guide_fee_excluded && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
          가이드/기사 경비는 불포함 항목이며 위 예상 부담금액에는 포함되지 않습니다.
        </p>
      )}
    </section>
  );
}

/** 하이라이트 태그 */
function formatShortDate(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return date;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year === new Date().getFullYear()
    ? `${month}/${day}`
    : `${year}년 ${month}월 ${day}일`;
}

function DepartureDatesSummary({ priceDates }: { priceDates?: LandingProductData['price_dates'] }) {
  const upcomingRows = getUpcomingPriceDates(priceDates, formatKstDate())
    .filter(row => row.date && row.price > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const rows = upcomingRows.slice(0, 5);
  if (rows.length === 0) {
    if (!priceDates?.length) return null;
    return (
      <section className="border-t border-gray-100 bg-white px-5 py-5">
        <h3 className="text-base font-bold text-gray-900">출발일 상담 확인</h3>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          원문에 기재된 출발일이 모두 지났습니다. 희망 일정을 남기면 현재 가능한 날짜와 요금을 다시 확인해 드립니다.
        </p>
      </section>
    );
  }
  const hiddenCount = Math.max(0, upcomingRows.length - rows.length);

  return (
    <section className="border-t border-gray-100 bg-white px-5 py-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-bold text-gray-900">출발 가능일</h3>
        {hiddenCount > 0 && (
          <span className="text-xs font-semibold text-[var(--brand)]">외 {hiddenCount}개 일정</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {rows.map((row, index) => (
          <div key={`${row.date}-${row.price}-${row.min_travelers ?? 'all'}-${index}`} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
            <p className="text-sm font-bold text-gray-900">{formatShortDate(row.date)}</p>
            <p className="mt-0.5 text-xs font-semibold text-gray-500">
              {row.price_relation === 'final_sale' && row.list_price && row.list_price > row.price && (
                <span className="mr-1 font-medium text-gray-400 line-through">{fmt(row.list_price)}원</span>
              )}
              {fmt(row.price)}원부터 {row.confirmed ? '조건 확인' : '상담 가능'}
            </p>
            {getPriceScopeLabel(row) && (
              <p className="mt-1 text-[11px] font-medium text-amber-700">{getPriceScopeLabel(row)}</p>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-gray-500">
        실제 좌석과 항공 조건은 상담 시점 기준으로 다시 확인합니다.
      </p>
    </section>
  );
}

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

function FlightSummary({ flight }: { flight: LandingProductData['flightSummary'] }) {
  const legs = [
    { label: '가는편', tone: 'text-[var(--brand)]', data: flight?.outbound },
    { label: '오는편', tone: 'text-orange-500', data: flight?.inbound },
  ].filter((leg): leg is { label: string; tone: string; data: NonNullable<LandingProductData['flightSummary']>['outbound'] & object } => Boolean(leg.data));

  if (legs.length === 0) return null;

  return (
    <section className="px-5 py-5 bg-white border-t border-gray-100">
      <div className="flex items-center gap-2 mb-3">
        <Plane className="w-4 h-4 text-[var(--brand)]" />
        <h3 className="text-base font-bold text-gray-900">항공 일정</h3>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {legs.map(({ label, tone, data }) => (
          <div key={label} className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className={`text-xs font-bold ${tone}`}>{label}</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {[data?.depCity, data?.arrCity].filter(Boolean).join(' → ') || data?.code || '항공편'}
                </p>
              </div>
              <div className="text-right">
                {data?.code && <p className="text-xs font-semibold text-gray-500">{data.code}</p>}
                {data?.arrDayOffset === 1 && (
                  <p className="text-xs font-bold text-orange-600">+1 익일 도착</p>
                )}
                <p className="mt-1 text-sm font-black text-gray-900 tabular-nums">
                  {[data?.depTime, data?.arrTime].filter(Boolean).join(' - ') || '시간 미정'}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ComparisonTrustPanel({ recommendation }: { recommendation: LandingProductData['recommendation'] }) {
  if (!recommendation) return null;
  const reasons = recommendation.reasons.slice(0, 3);
  return (
    <section className="border-t border-blue-100 bg-blue-50 px-5 py-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-lg shadow-sm">
          🔍
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-blue-900 leading-snug">
            {recommendation.label}
          </p>
          <p className="mt-1 text-sm font-medium text-blue-800 leading-relaxed break-keep">
            {recommendation.comparisonSummary}
          </p>
          {reasons.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {recommendation.hasComparison && recommendation.rankInGroup != null && recommendation.rankInGroup <= 3 && (
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-blue-700">
                  비교 {recommendation.rankInGroup}위
                </span>
              )}
              {recommendation.hotelGradeLabel && (
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-blue-700">
                  {recommendation.hotelGradeLabel}
                </span>
              )}
              {reasons.map((reason) => (
                <span key={reason} className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-blue-700">
                  {reason}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className="mt-3 text-xs font-medium text-blue-700/80 leading-relaxed">
        후기가 적은 상품도 가격·호텔·쇼핑·옵션 조건을 먼저 비교해 보여드려요.
      </p>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 (RSC가 initialData 주입 — 클라이언트는 채널·트래킹·시트만)
// ─────────────────────────────────────────────────────────────────────────────

const TERMS_SUMMARY_TYPES = ['RESERVATION', 'AUTO_TICKETING', 'BUSINESS_HOURS'];

export function LandingClient({
  initialData,
  initialNotices = [],
}: {
  initialData: LandingProductData;
  initialNotices?: NoticeBlock[];
}) {
  const searchParams = useSearchParams();
  const source = (searchParams?.get('source') ?? 'default') as ChannelSource;
  const validSource: ChannelSource = ['insta', 'kakao'].includes(source) ? source : 'default';

  const data = initialData;

  const hasSpecialTerms = initialNotices.some(n => (n._tier ?? 1) >= 3);
  const termsSummary = initialNotices
    .filter(n => TERMS_SUMMARY_TYPES.includes(n.type))
    .map(sanitizeNoticeForCustomerSurface)
    .filter((notice): notice is NoticeBlock => Boolean(notice))
    .map(n => `【${n.title}】\n${n.text}`)
    .join('\n\n') || undefined;

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
    trackAnalyticsEvent('view_item', {
      package_id: data.id,
      package_name: data.customMessage.default.headline,
      destination: data.destination,
      departure_date: data.departureFullDate ?? undefined,
      currency: 'KRW',
      value: data.priceFrom > 0 ? data.priceFrom : undefined,
      price_type: data.priceFrom > 0 ? 'from_price' : 'inquiry',
      items: [{
        item_id: data.id,
        item_name: data.customMessage.default.headline,
        item_category: 'travel_package',
        item_category2: data.destination,
        item_variant: data.departureFullDate ?? undefined,
        price: data.priceFrom > 0 ? data.priceFrom : undefined,
        quantity: 1,
      }],
    }, { dedupeKey: `lp:${data.id}` });
  }, [
    data.customMessage.default.headline,
    data.departureFullDate,
    data.destination,
    data.priceFrom,
    data.id,
  ]);

  // ── Hooks must be called before any early return (react-hooks/rules-of-hooks) ──
  // Intersection Observer → FAB 활성화
  const { itineraryViewed, setItineraryViewed, registerScrollSentinel, getSnapshot } = useTracking();
  const handleItineraryViewed = useCallback(() => {
    setItineraryViewed(true);
    trackAnalyticsEvent('ysn_schedule_view', {
      package_id: data.id,
      package_name: data.customMessage.default.headline,
      destination: data.destination,
    }, { dedupeKey: `lp:${data.id}:schedule` });
  }, [data.customMessage.default.headline, data.destination, data.id, setItineraryViewed]);

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
  const utmTerm = sanitizeUtmTermForDisplay(searchParams?.get('utm_term') ?? null);

  // 채널별 히어로 스타일
  const isInsta = validSource === 'insta';
  const isKakao = validSource === 'kakao';
  const heroImage = isInsta ? data.heroImageA : data.heroImageB;
  const heroMedia = data.heroMedia;
  const heroIsReferenceImage = heroMedia?.reference_only === true;

  const fabText = '일정·인원 입력하고 상담받기';

  const hasReviewStats = data.reviewCount >= 1;

  return (
    <div className="min-h-screen bg-[var(--bg-section)] text-[var(--text-primary)] max-w-[430px] mx-auto relative pb-36">

      <div className="flex justify-end px-4 py-2.5 border-b border-[var(--border-mid)] bg-white/90 backdrop-blur-sm sticky top-0 z-30">
        <Link href={`/packages/${encodeURIComponent(data.id)}`} className="text-xs font-semibold text-[var(--brand)] hover:underline">
          전체 일정·약관 보기
        </Link>
      </div>

      {data.departureFullDate && data.scarcityRemaining != null && (
        <ScarcityTicker seats={data.scarcityRemaining} dateLabel={data.departureDateLabel} />
      )}

      {/* 스크롤 25% 센티널 */}
      <div ref={sentinel25Ref} className="absolute" style={{ top: '25%', height: 1, width: 1, pointerEvents: 'none' }} />

      {/* ── 히어로 섹션 ────────────────────────────────────────── */}
      <section className="relative overflow-hidden min-h-[240px]" style={{ height: '72vw', maxHeight: 360 }}>
        <SafeCoverImg
          src={heroImage}
          alt={heroMedia?.alt ?? `${data.destination}${heroIsReferenceImage ? ' 참고 이미지' : ''}`}
          className="absolute inset-0 h-full w-full object-cover"
          loading="eager"
          fetchPriority="high"
          fallback={<div className="absolute inset-0 bg-gradient-to-br from-text-primary via-brand-dark to-brand" />}
        />
        {heroIsReferenceImage && (
          <span className="absolute top-3 right-4 z-[1] rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold text-white/90 backdrop-blur-sm">
            {heroMedia?.label ?? '여행지 참고 이미지'}
          </span>
        )}
        {heroMedia?.attribution_text && heroMedia.attribution_url && (
          <div className="absolute top-12 right-4 z-[2] flex max-w-[78%] flex-wrap justify-end gap-x-2 gap-y-1 rounded bg-black/55 px-2 py-1 text-[9px] leading-tight text-white/85 backdrop-blur-sm">
            <a
              href={heroMedia.attribution_url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-white/40"
            >
              {heroMedia.attribution_text}
            </a>
            {heroMedia.license_url && (
              <a
                href={heroMedia.license_url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-white/40"
              >
                {heroMedia.license_code ? `${heroMedia.license_code} 확인` : '라이선스 확인'}
              </a>
            )}
          </div>
        )}
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
            data-analytics-id="lp_hero_kakao"
            className="flex-1 py-3 rounded-xl bg-[#FEE500] text-sm font-bold text-text-primary active:scale-[0.98] transition-transform shadow-md"
              onClick={async () => {
                trackAnalyticsEvent('ysn_kakao_click', {
                  cta_location: 'lp_hero',
                  page_type: 'campaign_landing',
                  package_id: data.id,
                  package_name: data.customMessage.default.headline,
                  destination: data.destination,
                  outbound_host: 'pf.kakao.com',
                });
                trackKakaoViewContent({
                  id: `lp_kakao_${data.id}`,
                  name: 'LP_카카오바로문의',
                  value: data.priceFrom,
                });
                await openKakaoChannel({
                  internalCode: data.internalCode,
                  productTitle: data.customMessage.default.headline,
                  intent: validSource,
                  budget: data.priceFrom ? `1인 ${data.priceFrom.toLocaleString()}원~` : null,
                  destination: data.destination,
                  selected_products: [data.customMessage.default.headline],
                });
              }}
            >
              카카오로 바로 문의
            </button>
            <Link
              href={`/packages/${encodeURIComponent(data.id)}`}
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

      <ComparisonTrustPanel recommendation={data.recommendation} />

      <PriceSection
        priceFrom={data.priceFrom}
        compareAtPrice={data.compareAtPrice}
        deadlineDays={data.deadlineDays}
        ticketingCondition={data.ticketingCondition}
        packageId={data.id}
        destination={data.destination}
        customerBudget={data.customerBudget}
      />

      <DepartureDatesSummary priceDates={data.price_dates} />

      <FlightSummary flight={data.flightSummary} />

      {/* ── 상세 요금표 (날짜/조건별 카드 UI) ──────────────────────── */}
      {data.price_list && data.price_list.length > 0 && (
        <PriceSectionCard
          title={`${data.destination} ${data.duration}`}
          destination={data.destination}
          priceList={data.price_list}
          singleSupplement={data.singleSupplement}
          guideTrip={data.guideTrip}
          customerBudget={data.customerBudget}
        />
      )}

      {/* ── 하이라이트 ──────────────────────────────────────────── */}
      <Highlights items={data.itinerary.highlights} />

      {/* 스크롤 50% 센티널 */}
      <div ref={sentinel50Ref} className="absolute" style={{ top: '50%', height: 1, width: 1, pointerEvents: 'none' }} />

      <LpDeferSectionsDyn
        days={data.itinerary.days}
        alternatives={data.itinerary.alternatives}
        onItineraryViewed={handleItineraryViewed}
        includes={data.itinerary.includes}
        excludes={data.itinerary.excludes}
        optionalTours={data.itinerary.optionalTours}
        legalNotices={data.itinerary.legalNotices}
        sourcePreparationNotices={Array.isArray(data.itinerary.sourcePreparationNotices) ? data.itinerary.sourcePreparationNotices : []}
        packageId={data.id}
        reviewScore={data.reviewScore}
        reviewCount={data.reviewCount}
        recommendation={data.recommendation}
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
            data-analytics-id="lp_sticky_lead"
            aria-label="상담 신청 열기"
            onClick={() => {
              trackAnalyticsEvent('begin_checkout', {
                package_id: data.id,
                package_name: data.customMessage.default.headline,
                destination: data.destination,
                departure_date: data.departureFullDate ?? undefined,
                currency: 'KRW',
                value: data.priceFrom > 0 ? data.priceFrom : undefined,
              }, { dedupeKey: `lp:${data.id}:lead-open` });
              setSheetOpen(true);
              fetch('/api/tracking/score-signal', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  package_id: data.id,
                  signal_type: 'lead_sheet_open',
                  session_id: getSessionId(),
                }),
              }).catch(() => {});
            }}
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
        defaultDate={data.departureFullDate ?? undefined}
        priceDates={data.price_dates}
        hasSpecialTerms={hasSpecialTerms}
        termsSummary={termsSummary}
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
          trackAnalyticsEvent('generate_lead', {
            lead_source: 'website',
            lead_type: 'package_inquiry',
            package_id: data.id,
            package_name: data.customMessage.default.headline,
            destination: data.destination,
            departure_date: form.desiredDate ?? data.departureFullDate ?? undefined,
          }, { dedupeKey: `lp:${data.id}:${form.desiredDate ?? data.departureFullDate ?? 'unknown'}` });
          setSheetOpen(false);
        }}
      />
    </div>
  );
}
