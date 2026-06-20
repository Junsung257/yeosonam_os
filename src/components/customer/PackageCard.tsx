'use client';

import { useState, useEffect, type MouseEvent } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { getMinPriceFromDates } from '@/lib/price-dates';
import { getAirlineName } from '@/lib/render-contract';
import { isSafeImageSrc } from '@/lib/image-url';
import { getSessionId } from '@/lib/tracker';
import { DestinationImageFallback } from '@/components/customer/SafeRemoteImage';

export interface PackageCardData {
  id: string;
  title: string;
  display_title?: string | null;
  hero_tagline?: string | null;
  destination?: string | null;
  duration?: number | null;
  nights?: number | null;
  price?: number | null;
  price_tiers?: { period_label?: string; departure_dates?: string[]; adult_price?: number }[] | null;
  price_dates?: { date: string; price: number; confirmed?: boolean }[] | null;
  product_type?: string | null;
  airline?: string | null;
  departure_airport?: string | null;
  product_highlights?: string[] | null;
  is_airtel?: boolean | null;
  hero_image_url?: string | null;
  thumbnail_urls?: string[] | null;
  avg_rating?: number | null;
  review_count?: number | null;
  seats_held?: number | null;
  seats_confirmed?: number | null;
  products?: { display_name?: string | null; internal_code?: string | null } | null;
  // 2026-05-19 박제 (PR #139 P2-A / A2): 같은 카탈로그 N 패키지 그룹 UUID
  catalog_id?: string | null;
}

interface Props {
  pkg: PackageCardData;
  image?: string | null;
  precomputedMinPrice?: number;
  variant?: 'vertical' | 'horizontal';
  isRecommended?: boolean;
  recommendedReasons?: string[];
  isReasonOpen?: boolean;
  onToggleReason?: (id: string) => void;
  onClick?: (id: string) => void;
  rankBadge?: string;
  isYeosonamPick?: boolean;
  primaryReason?: string;
  lossAversionText?: string;
  comparisonLabel?: string;
  comparisonSummary?: string;
  comparisonReasons?: string[];
  comparisonRank?: number | null;
  comparisonGroupSize?: number | null;
  hotelGradeLabel?: string | null;
  trackingIntent?: string | null;
  /** 랭킹 오버레이 숫자 (RankingSection 전용) */
  rankNumber?: number;
  /** 2026-05-19 박제 (P2-A / A2): 같은 catalog_id 그룹 안의 패키지 수 (≥2 면 "분기 선택 가능" 배지) */
  catalogGroupCount?: number;
}

function computeMinPrice(pkg: PackageCardData): number {
  if (pkg.price_dates && pkg.price_dates.length > 0) {
    const v = getMinPriceFromDates(pkg.price_dates as unknown as Parameters<typeof getMinPriceFromDates>[0]);
    if (v && v > 0) return v;
  }
  if (pkg.price_tiers && pkg.price_tiers.length > 0) {
    const tierPrices = pkg.price_tiers
      .map(t => t.adult_price)
      .filter((v): v is number => typeof v === 'number' && v > 0);
    if (tierPrices.length > 0) return Math.min(...tierPrices);
  }
  return pkg.price ?? 0;
}

function pickImage(pkg: PackageCardData, override?: string | null): string | null {
  if (override) return override;
  if (pkg.hero_image_url) return pkg.hero_image_url;
  if (pkg.thumbnail_urls && pkg.thumbnail_urls.length > 0) return pkg.thumbnail_urls[0];
  return null;
}

function pickTitle(pkg: PackageCardData): string {
  return pkg.display_title || pkg.products?.display_name || pkg.title;
}

function formatDuration(pkg: PackageCardData): string | null {
  if (pkg.nights && pkg.duration) return `${pkg.nights}박${pkg.duration}일`;
  if (pkg.duration) return `${Math.max(0, pkg.duration - 1)}박${pkg.duration}일`;
  return null;
}

function cleanPipeLabel(value?: string | null): string | null {
  const label = value?.split('|')[0]?.trim();
  return label || null;
}

function countDepartureOptions(pkg: PackageCardData): number {
  const dates = new Set<string>();
  pkg.price_dates?.forEach((item) => {
    if (item?.date) dates.add(item.date);
  });
  pkg.price_tiers?.forEach((tier) => {
    tier.departure_dates?.forEach((date) => {
      if (date) dates.add(date);
    });
  });
  return dates.size;
}

function countConfirmedDepartureOptions(pkg: PackageCardData): number {
  return pkg.price_dates?.filter((item) => item?.date && item.confirmed).length ?? 0;
}

function buildTravelMeta(pkg: PackageCardData, duration: string | null, nextDate: string | null, airlineName: string | null): string[] {
  return [
    nextDate ? `${nextDate} 출발` : '출발일 확인',
    duration,
    pkg.departure_airport ? `${pkg.departure_airport} 출발` : null,
    airlineName,
  ].filter((item): item is string => Boolean(item)).slice(0, 4);
}

function todayKst(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}

function findNextDeparture(pkg: PackageCardData): string | null {
  const today = todayKst();
  const dates: string[] = [];
  if (pkg.price_dates) {
    for (const d of pkg.price_dates) if (d?.date && d.date >= today) dates.push(d.date);
  }
  if (dates.length === 0 && pkg.price_tiers) {
    for (const t of pkg.price_tiers) {
      for (const d of t.departure_dates || []) if (d && d >= today) dates.push(d);
    }
  }
  if (dates.length === 0) return null;
  dates.sort();
  const d = dates[0];
  const parts = d.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return d;
  const [, m, day] = parts;
  const dt = new Date(parts[0], m - 1, day);
  const dayKor = ['일', '월', '화', '수', '목', '금', '토'][dt.getDay()];
  return `${m}/${day}(${dayKor})`;
}

function ProductTypeBadge({ type }: { type: string }) {
  const label = cleanPipeLabel(type);
  if (!label) return null;
  const cls =
    type.includes('실속') ? 'bg-orange-50 text-orange-700' :
    type.includes('프리미엄') || type.includes('고품격') ? 'bg-brand-light text-brand' :
    type.includes('노팁') ? 'bg-success-light text-success' :
    'bg-brand-light text-brand';
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>
      {label}
    </span>
  );
}

function SeatBadge({ pkg }: { pkg: PackageCardData }) {
  const held = pkg.seats_held ?? 0;
  const confirmed = pkg.seats_confirmed ?? 0;
  if (held === 0) return null;
  const remaining = held - confirmed;
  if (remaining <= 0) return <span className="text-xs font-semibold text-text-secondary line-through">예약 마감</span>;
  if (remaining <= 5) return <span className="text-xs font-bold text-danger animate-pulse">잔여 {remaining}석</span>;
  return null;
}

export default function PackageCard({
  pkg,
  image,
  precomputedMinPrice,
  variant = 'vertical',
  isRecommended = false,
  recommendedReasons = [],
  isReasonOpen = false,
  onToggleReason,
  onClick,
  rankBadge,
  isYeosonamPick = false,
  primaryReason,
  lossAversionText,
  comparisonLabel,
  comparisonSummary,
  comparisonReasons = [],
  comparisonRank,
  comparisonGroupSize,
  hotelGradeLabel,
  trackingIntent,
  rankNumber,
  catalogGroupCount,
}: Props) {
  const title = pickTitle(pkg);
  const minPrice = precomputedMinPrice ?? computeMinPrice(pkg);
  const img = pickImage(pkg, image);
  const airlineName = getAirlineName(pkg.airline ?? undefined) ?? pkg.airline ?? null;
  const duration = formatDuration(pkg);
  const nextDate = findNextDeparture(pkg);
  const hasComparisonSignal = Boolean(comparisonLabel || comparisonSummary);
  const packageHref = `/packages/${encodeURIComponent(pkg.id)}`;
  const reasonPanelId = `package-card-reasons-${pkg.id}`;
  const decisionSummaryId = `package-card-decision-summary-${pkg.id}`;

  useEffect(() => {
    if (!isRecommended && !hasComparisonSignal) return;
    const session_id = getSessionId();
    fetch('/api/tracking/score-signal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        package_id: pkg.id,
        signal_type: 'recommend_badge_view',
        group_key: trackingIntent ? `intent:${trackingIntent}` : null,
        rank: comparisonRank ?? null,
        session_id,
      }),
    }).catch(() => {});
    if (isRecommended) {
      fetch('/api/tracking/recommendation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          package_id: pkg.id,
          source: 'mobile_card',
          outcome: null,
          recommended_rank: comparisonRank ?? null,
          intent: trackingIntent ?? null,
          session_id,
        }),
      }).catch(() => {});
    }
  }, [comparisonRank, hasComparisonSignal, isRecommended, pkg.id, trackingIntent]);

  const handleClick = () => {
    onClick?.(pkg.id);
    if (isRecommended) {
      fetch('/api/tracking/recommendation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          package_id: pkg.id,
          source: 'list_badge',
          outcome: 'click',
          recommended_rank: comparisonRank ?? null,
          intent: trackingIntent ?? null,
          session_id: getSessionId(),
        }),
      }).catch(() => {});
    }
  };

  const handleReasonToggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    fetch('/api/tracking/score-signal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        package_id: pkg.id,
        signal_type: 'recommend_reason_open',
        group_key: trackingIntent ? `intent:${trackingIntent}` : null,
        session_id: getSessionId(),
      }),
    }).catch(() => {});
    onToggleReason?.(pkg.id);
  };

  if (variant === 'horizontal') {
    return (
      <div className="relative w-full min-w-0 max-w-full">
      <Link
        href={packageHref}
        onClick={handleClick}
        data-testid="package-card-link"
        aria-label={`${title} 상세 보기`}
        aria-describedby={decisionSummaryId}
        className="block card-touch w-full min-w-0 max-w-full"
      >
        <div className="flex md:flex-col gap-3 md:gap-0 py-4 md:py-0 border-b md:border-b-0 border-admin-border last:border-b-0 md:bg-white md:rounded-[16px] md:shadow-card md:overflow-hidden md:hover:shadow-card-hover md:transition-shadow w-full min-w-0 max-w-full">
          <CardImage
            img={img}
            title={title}
            destination={pkg.destination}
            airlineName={airlineName}
            sizeClass="w-[128px] h-[104px] md:w-full md:aspect-[4/3] md:h-auto rounded-[12px] md:rounded-none"
            sizes="(max-width: 768px) 128px, (max-width: 1024px) 50vw, 33vw"
            isYeosonamPick={isYeosonamPick}
            rankNumber={rankNumber}
          />
          <CardBody
            pkg={pkg} title={title} airlineName={airlineName} duration={duration} nextDate={nextDate} minPrice={minPrice} compact
            rankBadge={rankBadge} primaryReason={primaryReason} lossAversionText={lossAversionText}
            comparisonLabel={comparisonLabel}
            comparisonSummary={comparisonSummary}
            comparisonReasons={comparisonReasons}
            comparisonRank={comparisonRank}
            comparisonGroupSize={comparisonGroupSize}
            hotelGradeLabel={hotelGradeLabel}
            catalogGroupCount={catalogGroupCount}
            decisionSummaryId={decisionSummaryId}
          />
        </div>
      </Link>
      <RecommendationReasonOverlay
        open={isReasonOpen}
        panelId={reasonPanelId}
        isRecommended={isRecommended}
        recommendedReasons={recommendedReasons}
        onToggle={handleReasonToggle}
        className="absolute top-5 right-1.5 z-20 md:top-2.5 md:right-2.5"
      />
      </div>
    );
  }

  return (
    <div className="relative">
    <Link
      href={packageHref}
      onClick={handleClick}
      data-testid="package-card-link"
      aria-label={`${title} 상세 보기`}
      aria-describedby={decisionSummaryId}
      className="group block bg-white rounded-[16px] overflow-hidden shadow-card md:hover:shadow-card-hover md:hover:-translate-y-1 transition-all duration-200 card-touch"
    >
      <CardImage
        img={img}
        title={title}
        destination={pkg.destination}
        airlineName={airlineName}
        sizeClass="w-full aspect-[4/3]"
        sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
        isYeosonamPick={isYeosonamPick}
        rankNumber={rankNumber}
      />
      <CardBody
        pkg={pkg} title={title} airlineName={airlineName} duration={duration} nextDate={nextDate} minPrice={minPrice}
        rankBadge={rankBadge} primaryReason={primaryReason} lossAversionText={lossAversionText}
        comparisonLabel={comparisonLabel}
        comparisonSummary={comparisonSummary}
        comparisonReasons={comparisonReasons}
        comparisonRank={comparisonRank}
        comparisonGroupSize={comparisonGroupSize}
        hotelGradeLabel={hotelGradeLabel}
        catalogGroupCount={catalogGroupCount}
        decisionSummaryId={decisionSummaryId}
      />
    </Link>
    <RecommendationReasonOverlay
      open={isReasonOpen}
      panelId={reasonPanelId}
      isRecommended={isRecommended}
      recommendedReasons={recommendedReasons}
      onToggle={handleReasonToggle}
      className="absolute top-1.5 right-1.5 z-20 md:top-2.5 md:right-2.5"
    />
    </div>
  );
}

// ── 내부 ────────────────────────────────────────────────────────────────────

function CardImage({
  img, title, destination, airlineName, sizeClass, sizes,
  isYeosonamPick, rankNumber,
}: {
  img: string | null; title: string; destination?: string | null; airlineName: string | null;
  sizeClass: string; sizes: string;
  isYeosonamPick?: boolean;
  rankNumber?: number;
}) {
  const safeSrc = img && isSafeImageSrc(img) ? img.trim() : null;
  const [imgBroken, setImgBroken] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  useEffect(() => {
    setImgBroken(false);
    setImgLoaded(false);
  }, [safeSrc]);
  const showImage = Boolean(safeSrc && !imgBroken);

  return (
    <div className={`relative flex-shrink-0 overflow-hidden bg-bg-section ${sizeClass}`}>
      {/* shimmer skeleton — 이미지 존재하고 로드 전일 때만 표시 */}
      {safeSrc && !imgLoaded && !imgBroken && (
        <div className="absolute inset-0 z-10 bg-gradient-to-r from-[#F2F4F6] via-[#E5E7EB] to-[#F2F4F6] animate-shimmer bg-[length:200%_100%]" aria-hidden />
      )}
      {showImage && safeSrc ? (
        <Image
          src={safeSrc}
          alt={title}
          fill
          className={`object-cover group-hover:scale-105 transition-transform duration-300 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
          sizes={sizes}
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgBroken(true)}
        />
      ) : (
        <DestinationImageFallback title={title} destination={destination} compact={sizeClass.includes('128px')} />
      )}

      {/* 랭킹 번호 오버레이 */}
      {rankNumber != null && (
        <span className="absolute left-3 bottom-3 text-[32px] font-extrabold text-white leading-none [text-shadow:0_2px_8px_rgba(0,0,0,0.4)]">
          {rankNumber}
        </span>
      )}

      {/* 여소남 픽 배지 */}
      {isYeosonamPick && (
        <div className="absolute top-2.5 left-2.5 z-10">
          <span className="bg-amber-400 text-amber-950 text-[11px] md:text-xs font-black px-2.5 py-1 rounded-full shadow-sm">
            여소남 픽
          </span>
        </div>
      )}

      {/* 항공사 배지 */}
      {airlineName && (
        <div className="absolute bottom-1.5 left-1.5 md:bottom-2.5 md:left-2.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-white/90 text-brand">
          {airlineName}
        </div>
      )}
    </div>
  );
}

function RecommendationReasonOverlay({
  open,
  panelId,
  isRecommended,
  recommendedReasons,
  onToggle,
  className = '',
}: {
  open: boolean;
  panelId: string;
  isRecommended: boolean;
  recommendedReasons: string[];
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}) {
  if (!isRecommended) return null;

  const visibleReasons = recommendedReasons.slice(0, 4);

  return (
    <div className={`flex w-fit flex-col items-end ${className}`}>
      <button
        type="button"
        data-testid="package-card-reason-toggle"
        onClick={onToggle}
        className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[10px] md:text-xs font-bold px-2.5 py-1 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md hover:scale-105 transition-transform cursor-pointer"
        aria-label={'\uCD94\uCC9C \uC0AC\uC720 \uBCF4\uAE30'}
        aria-expanded={open}
        aria-controls={panelId}
      >
        {'\uCD94\uCC9C'}
      </button>
      {open && (
        <div
          id={panelId}
          data-testid="package-card-reason-panel"
          role="region"
          aria-label={'\uCD94\uCC9C \uC0AC\uC720'}
          className="mt-1.5 z-20 bg-white shadow-modal rounded-[12px] p-2.5 text-[11px] text-text-body max-w-[220px] border border-admin-border"
        >
          <div className="font-semibold text-amber-700 mb-1.5">{'\uCD94\uCC9C \uADFC\uAC70'}</div>
          {visibleReasons.length > 0 ? (
            <ul className="space-y-1">
              {visibleReasons.map((reason) => (
                <li key={reason} className="flex gap-1.5">
                  <span className="text-amber-500 flex-shrink-0" aria-hidden>-</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>{'\uC774 \uC5EC\uD589 \uC870\uAC74\uACFC \uC798 \uB9DE\uB294 \uC0C1\uD488\uC785\uB2C8\uB2E4.'}</p>
          )}
        </div>
      )}
    </div>
  );
}
function CardBody({
  pkg, title, airlineName, duration, nextDate, minPrice, compact = false,
  rankBadge, primaryReason, lossAversionText, comparisonLabel, comparisonSummary, comparisonReasons,
  comparisonRank, comparisonGroupSize, hotelGradeLabel, catalogGroupCount, decisionSummaryId,
}: {
  pkg: PackageCardData; title: string; airlineName: string | null;
  duration: string | null; nextDate: string | null; minPrice: number;
  compact?: boolean;
  rankBadge?: string; primaryReason?: string; lossAversionText?: string;
  comparisonLabel?: string;
  comparisonSummary?: string;
  comparisonReasons?: string[];
  comparisonRank?: number | null;
  comparisonGroupSize?: number | null;
  hotelGradeLabel?: string | null;
  catalogGroupCount?: number;
  decisionSummaryId: string;
}) {
  const hasCatalogGroup = (catalogGroupCount ?? 0) >= 2;
  const hasReviews = pkg.avg_rating != null && pkg.review_count != null && pkg.review_count > 0;
  const hasComparisonSignal = Boolean(comparisonLabel || comparisonSummary);
  const showComparisonTrust = !hasReviews && Boolean(comparisonLabel || comparisonSummary);
  const safeComparisonReasons = (comparisonReasons ?? []).slice(0, 3);
  const availableSeats = Math.max(0, (pkg.seats_held ?? 0) - (pkg.seats_confirmed ?? 0));
  const departureOptionCount = countDepartureOptions(pkg);
  const confirmedDepartureCount = countConfirmedDepartureOptions(pkg);
  const travelMetaItems = buildTravelMeta(pkg, duration, nextDate, airlineName);
  const themeLabel = cleanPipeLabel(pkg.product_type) ?? (pkg.is_airtel ? '에어텔' : pkg.product_highlights?.[0] ?? null);
  const proofItems = [
    departureOptionCount > 0 ? `출발일 ${departureOptionCount}개` : nextDate ? `출발 ${nextDate}` : null,
    confirmedDepartureCount > 0 ? `확정 ${confirmedDepartureCount}회` : null,
    airlineName,
    hasReviews ? `후기 ${Number(pkg.avg_rating).toFixed(1)}(${pkg.review_count})` : null,
    availableSeats > 5 ? `잔여 ${availableSeats}석` : null,
  ].filter((item): item is string => Boolean(item)).slice(0, 4);
  const trustBadges = [
    hasComparisonSignal ? (comparisonLabel || '조건 비교 완료') : null,
    confirmedDepartureCount > 0 ? '확정 출발 포함' : null,
    hasReviews ? `후기 ${Number(pkg.avg_rating).toFixed(1)}` : null,
    availableSeats > 5 ? `잔여 ${availableSeats}석` : null,
    rankBadge ?? null,
  ].filter((item): item is string => Boolean(item)).slice(0, 4);
  const proofSummaryText = proofItems.length > 0
    ? `검증 근거: ${proofItems.join(', ')}`
    : '검증 근거: 상세에서 출발일과 포함 조건 확인';
  const priceDecisionLabel = minPrice > 0 ? `${minPrice.toLocaleString('ko-KR')}원~` : '가격 문의';
  const departureDecisionLabel = nextDate ?? '출발일 확인';
  const cardNextActionLabel =
    minPrice <= 0 ? '가격 상담'
    : hasComparisonSignal ? '비교 후 상담'
    : nextDate ? '일정 확인'
    : '포함 조건 확인';
  const cardNextActionReason =
    minPrice <= 0 ? '가격이 확정되지 않아 상담으로 조건 확인이 먼저입니다.'
    : hasComparisonSignal ? '비슷한 조건의 상품이 있어 비교 후 상담하면 선택이 쉬워집니다.'
    : nextDate ? '출발 가능일이 있어 일정과 포함 조건을 바로 확인할 수 있습니다.'
    : '출발일 정보가 부족해 상세 포함 조건 확인이 먼저입니다.';
  const cardDecisionItems = [
    { label: '가격', value: priceDecisionLabel },
    { label: '출발', value: departureDecisionLabel },
    { label: '다음', value: cardNextActionLabel },
  ];
  const cardDecisionSummaryText = `${title} 카드 판단 요약: 가격 ${priceDecisionLabel}, 출발 ${departureDecisionLabel}, 다음 액션 ${cardNextActionLabel}. 이유: ${cardNextActionReason} ${proofSummaryText}`;
  return (
    <div
      data-testid="package-card-hierarchy"
      className={`flex-1 min-w-0 ${compact ? 'p-3 md:p-5' : 'p-4 md:p-5'}`}
    >
      <div className="flex items-center gap-1.5 text-micro font-bold min-w-0">
        {pkg.destination && <span className="text-brand truncate max-w-[150px]">{pkg.destination}</span>}
        {themeLabel && (
          <>
            {pkg.destination && <span className="shrink-0 text-text-tertiary">·</span>}
            <span className="truncate text-text-secondary">{themeLabel}</span>
          </>
        )}
      </div>

      {/* 핵심 추천 사유 */}
      {primaryReason && (
        <div className="mt-2 text-[13px] font-bold text-brand leading-snug flex items-start gap-1">
          <span className="text-amber-500">🥇</span> <span>{primaryReason}</span>
        </div>
      )}

      {/* 상품명 */}
      <h2 className="mt-1.5 text-[15px] md:text-[17px] font-bold text-text-primary leading-snug line-clamp-2">
        {title}
      </h2>

      <div
        data-testid="package-card-travel-meta"
        className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold text-text-secondary"
      >
        {travelMetaItems.map((item) => (
          <span key={item} className="min-w-0 max-w-full rounded-full bg-bg-section px-2 py-0.5 truncate">
            {item}
          </span>
        ))}
      </div>

      {(pkg.product_type || pkg.is_airtel) && (
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {pkg.product_type && <ProductTypeBadge type={pkg.product_type} />}
          {pkg.is_airtel && themeLabel !== '에어텔' && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-brand-light text-brand">에어텔</span>
          )}
        </div>
      )}

      {showComparisonTrust && (
        <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2">
          <p className="text-[12px] font-extrabold text-blue-800 leading-snug">
            {comparisonLabel || '조건을 비교했어요 🔍'}
          </p>
          {comparisonSummary && (
            <p className="mt-0.5 text-[11px] font-medium text-blue-700 leading-snug break-keep">
              {comparisonSummary}
            </p>
          )}
          {(safeComparisonReasons.length > 0 || hotelGradeLabel || ((comparisonGroupSize ?? 0) >= 2 && comparisonRank)) && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(comparisonGroupSize ?? 0) >= 2 && comparisonRank != null && comparisonRank <= 3 && (
                <span className="text-[10px] font-bold rounded-full bg-white px-2 py-0.5 text-blue-700">
                  비교 {comparisonRank}위
                </span>
              )}
              {hotelGradeLabel && (
                <span className="text-[10px] font-bold rounded-full bg-white px-2 py-0.5 text-blue-700">
                  {hotelGradeLabel}
                </span>
              )}
              {safeComparisonReasons.slice(0, hotelGradeLabel ? 1 : 2).map((reason) => (
                <span key={reason} className="text-[10px] font-bold rounded-full bg-white px-2 py-0.5 text-blue-700">
                  {reason}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2026-05-19 박제 (P2-A / A2 / 전문가 근거):
          Shopify Polaris "brand vs utility 분리" + Material 3 secondary indigo.
          violet 은 AI 추천 도메인 (ChatWidget/RecommendationSection) 이라 의미 충돌.
          워딩: "비슷한 일정" 자연어 — Baymard 17% variant confusion 완화. */}
      {hasCatalogGroup && (
        <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded-full">
          📚 비슷한 일정 +{(catalogGroupCount ?? 1) - 1}개 옵션
        </p>
      )}

      {/* 손실 회피 문구 */}
      {lossAversionText && (
        <p className="mt-1.5 text-micro font-bold text-danger bg-danger-light inline-block px-2 py-0.5 rounded-full">
          🚨 {lossAversionText}
        </p>
      )}

      {/* 한 줄 후킹 */}
      {!lossAversionText && pkg.hero_tagline && (
        <p className="mt-1 text-[13px] text-text-body leading-snug line-clamp-1 break-keep">
          {pkg.hero_tagline}
        </p>
      )}

      {/* 하이라이트 칩 */}
      {pkg.product_highlights && pkg.product_highlights.length > 0 && (
        <div className="flex gap-1.5 mt-2.5 flex-wrap">
          {pkg.product_highlights.slice(0, 3).map((tag, i) => (
            <span key={i} className="text-micro text-brand bg-brand-light px-2 py-0.5 rounded-full font-medium">{tag}</span>
          ))}
        </div>
      )}

      {/* 가격 + CTA */}
      <div className="mt-3 md:mt-4 flex items-end justify-between gap-2">
        <div className="min-w-0 flex flex-col gap-1">
          <div className="flex items-baseline gap-0.5 flex-wrap">
          {minPrice > 0 ? (
            <>
              <span className="text-price md:text-h1 text-brand tabular-nums">
                {minPrice.toLocaleString()}
              </span>
              <span className="text-micro font-medium text-text-secondary ml-0.5">원~</span>
              <span className="ml-1.5 text-[10px] font-medium text-text-secondary bg-slate-100 px-1.5 py-0.5 rounded-md">최저가</span>
            </>
          ) : (
            <span className="text-body text-text-secondary">가격 문의</span>
          )}
          </div>
        </div>
        <span className="inline-flex h-8 min-w-[76px] shrink-0 items-center justify-center rounded-full bg-brand px-3 text-[12px] font-bold text-white shadow-sm transition-colors group-hover:bg-[#1B64DA]">
          상세 보기
        </span>
      </div>

      <div
        data-testid="package-card-trust-badges"
        className="mt-2 flex min-h-[22px] flex-wrap items-center gap-1.5"
      >
        {trustBadges.length > 0 ? (
          trustBadges.map((badge) => (
            <span
              key={badge}
              className="max-w-full rounded-full bg-success-light px-2 py-0.5 text-[10px] font-extrabold text-success truncate"
            >
              {badge}
            </span>
          ))
        ) : (
          <span className="rounded-full bg-bg-section px-2 py-0.5 text-[10px] font-bold text-text-secondary">
            상세 조건 확인
          </span>
        )}
        <SeatBadge pkg={pkg} />
      </div>

      <div
        data-testid="package-card-proof-strip"
        aria-label={proofSummaryText}
        className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-text-secondary">
          검증 근거
        </span>
        {proofItems.length > 0 ? (
          proofItems.map((item) => (
            <span
              key={item}
              className="shrink-0 rounded-full border border-border-subtle bg-white px-2 py-0.5 text-[10px] font-bold text-text-secondary"
            >
              {item}
            </span>
          ))
        ) : (
          <span className="shrink-0 rounded-full border border-border-subtle bg-white px-2 py-0.5 text-[10px] font-bold text-text-tertiary">
            상세 확인
          </span>
        )}
      </div>

      <div
        id={decisionSummaryId}
        data-testid="package-card-decision-summary"
        aria-label={cardDecisionSummaryText}
        className="mt-2.5 border-t border-border-subtle pt-2"
      >
        <div className="grid grid-cols-3 gap-1.5">
          {cardDecisionItems.map((item) => (
            <span key={`${item.label}-${item.value}`} className="min-w-0">
              <span className="block text-[10px] font-bold text-text-tertiary">{item.label}</span>
              <span className="mt-0.5 block truncate text-[11px] font-black text-text-primary">{item.value}</span>
            </span>
          ))}
        </div>
        <p
          data-testid="package-card-next-action-reason"
          className="mt-1.5 text-[10px] font-bold leading-4 text-text-secondary"
        >
          {cardNextActionReason}
        </p>
      </div>
    </div>
  );
}
