'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { getMinPriceFromDates } from '@/lib/price-dates';
import { getAirlineName } from '@/lib/render-contract';
import { isSafeImageSrc } from '@/lib/image-url';

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
  /** 랭킹 오버레이 숫자 (RankingSection 전용) */
  rankNumber?: number;
}

function computeMinPrice(pkg: PackageCardData): number {
  if (pkg.price_dates && pkg.price_dates.length > 0) {
    const v = getMinPriceFromDates(pkg.price_dates as any);
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
  const cls =
    type.includes('실속') ? 'bg-orange-50 text-orange-700' :
    type.includes('프리미엄') || type.includes('고품격') ? 'bg-brand-light text-brand' :
    type.includes('노팁') ? 'bg-success-light text-success' :
    'bg-brand-light text-brand';
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>
      {type.split('|')[0]}
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
  rankNumber,
}: Props) {
  const title = pickTitle(pkg);
  const minPrice = precomputedMinPrice ?? computeMinPrice(pkg);
  const img = pickImage(pkg, image);
  const airlineName = getAirlineName(pkg.airline ?? undefined) ?? pkg.airline ?? null;
  const duration = formatDuration(pkg);
  const nextDate = findNextDeparture(pkg);

  const handleClick = () => {
    onClick?.(pkg.id);
    if (isRecommended) {
      fetch('/api/tracking/recommendation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ package_id: pkg.id, source: 'list_badge', outcome: 'click' }),
      }).catch(() => {});
    }
  };

  if (variant === 'horizontal') {
    return (
      <Link
        href={`/packages/${pkg.id}`}
        onClick={handleClick}
        className="block card-touch w-full min-w-0 max-w-full"
      >
        <div className="flex md:flex-col gap-3 md:gap-0 py-4 md:py-0 border-b md:border-b-0 border-admin-border last:border-b-0 md:bg-white md:rounded-[16px] md:shadow-card md:overflow-hidden md:hover:shadow-card-hover md:transition-shadow w-full min-w-0 max-w-full">
          <CardImage
            img={img}
            title={title}
            airlineName={airlineName}
            isRecommended={isRecommended}
            isReasonOpen={isReasonOpen}
            recommendedReasons={recommendedReasons}
            onToggleReason={onToggleReason ? () => onToggleReason(pkg.id) : undefined}
            sizeClass="w-[128px] h-[104px] md:w-full md:aspect-[4/3] md:h-auto rounded-[12px] md:rounded-none"
            sizes="(max-width: 768px) 128px, (max-width: 1024px) 50vw, 33vw"
            isYeosonamPick={isYeosonamPick}
            rankNumber={rankNumber}
          />
          <CardBody
            pkg={pkg} title={title} airlineName={airlineName} duration={duration} nextDate={nextDate} minPrice={minPrice} compact
            rankBadge={rankBadge} primaryReason={primaryReason} lossAversionText={lossAversionText}
          />
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={`/packages/${pkg.id}`}
      onClick={handleClick}
      className="group block bg-white rounded-[16px] overflow-hidden shadow-card md:hover:shadow-card-hover md:hover:-translate-y-1 transition-all duration-200 card-touch"
    >
      <CardImage
        img={img}
        title={title}
        airlineName={airlineName}
        isRecommended={isRecommended}
        isReasonOpen={isReasonOpen}
        recommendedReasons={recommendedReasons}
        onToggleReason={onToggleReason ? () => onToggleReason(pkg.id) : undefined}
        sizeClass="w-full aspect-[4/3]"
        sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
        isYeosonamPick={isYeosonamPick}
        rankNumber={rankNumber}
      />
      <CardBody
        pkg={pkg} title={title} airlineName={airlineName} duration={duration} nextDate={nextDate} minPrice={minPrice}
        rankBadge={rankBadge} primaryReason={primaryReason} lossAversionText={lossAversionText}
      />
    </Link>
  );
}

// ── 내부 ────────────────────────────────────────────────────────────────────

function CardImage({
  img, title, airlineName, isRecommended, isReasonOpen, recommendedReasons, onToggleReason, sizeClass, sizes,
  isYeosonamPick, rankNumber,
}: {
  img: string | null; title: string; airlineName: string | null;
  isRecommended: boolean; isReasonOpen: boolean; recommendedReasons: string[];
  onToggleReason?: () => void;
  sizeClass: string; sizes: string;
  isYeosonamPick?: boolean;
  rankNumber?: number;
}) {
  const safeSrc = img && isSafeImageSrc(img) ? img.trim() : null;
  const [imgBroken, setImgBroken] = useState(false);
  useEffect(() => {
    setImgBroken(false);
  }, [safeSrc]);
  const showImage = Boolean(safeSrc && !imgBroken);

  return (
    <div className={`relative flex-shrink-0 overflow-hidden bg-bg-section ${sizeClass}`}>
      {showImage && safeSrc ? (
        <Image
          src={safeSrc}
          alt={title}
          fill
          className="object-cover group-hover:scale-105 transition-transform duration-300"
          sizes={sizes}
          onError={() => setImgBroken(true)}
        />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-brand-light to-[#F2F4F6] flex items-center justify-center text-2xl md:text-5xl">🌍</div>
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

      {isRecommended && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleReason?.();
            }}
            className="absolute top-1.5 right-1.5 md:top-2.5 md:right-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-[10px] md:text-xs font-bold px-2.5 py-1 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md hover:scale-105 transition-transform cursor-pointer"
            aria-label="추천 사유 보기"
          >
            추천 ⓘ
          </button>
          {isReasonOpen && recommendedReasons.length > 0 && (
            <div
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
              className="absolute top-9 right-1.5 md:top-10 md:right-2.5 z-20 bg-white shadow-modal rounded-[12px] p-2.5 text-[11px] text-text-body max-w-[220px] border border-admin-border"
            >
              <div className="font-semibold text-amber-700 mb-1.5">왜 추천?</div>
              <ul className="space-y-1">
                {recommendedReasons.slice(0, 4).map((r, i) => (
                  <li key={i} className="flex gap-1.5"><span className="text-amber-500 flex-shrink-0">•</span><span>{r}</span></li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CardBody({
  pkg, title, airlineName, duration, nextDate, minPrice, compact = false,
  rankBadge, primaryReason, lossAversionText,
}: {
  pkg: PackageCardData; title: string; airlineName: string | null;
  duration: string | null; nextDate: string | null; minPrice: number;
  compact?: boolean;
  rankBadge?: string; primaryReason?: string; lossAversionText?: string;
}) {
  return (
    <div className={`flex-1 min-w-0 ${compact ? 'p-3 md:p-5' : 'p-4 md:p-5'}`}>
      {/* 목적지 + 일정 메타 */}
      <div className="flex items-center gap-1.5 text-micro text-text-secondary font-medium min-w-0 truncate">
        {pkg.destination && <span className="text-brand font-bold truncate max-w-[140px]">{pkg.destination}</span>}
        {duration && <><span className="flex-shrink-0">·</span><span className="flex-shrink-0">{duration}</span></>}
        {nextDate && <><span className="flex-shrink-0">·</span><span className="flex-shrink-0">{nextDate} 출발</span></>}
      </div>

      {/* 상품 타입 배지 */}
      {(pkg.product_type || pkg.is_airtel) && (
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {pkg.product_type && <ProductTypeBadge type={pkg.product_type} />}
          {pkg.is_airtel && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-brand-light text-brand">에어텔</span>}
        </div>
      )}

      {/* 핵심 추천 사유 */}
      {primaryReason && (
        <div className="mt-2 text-[13px] font-bold text-brand leading-snug flex items-start gap-1">
          <span className="text-amber-500">🥇</span> <span>{primaryReason}</span>
        </div>
      )}

      {/* 상품명 */}
      <h2 className="mt-1.5 text-[15px] md:text-[17px] font-bold text-text-primary leading-snug line-clamp-2 tracking-[-0.02em]">
        {title}
      </h2>

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

      {/* 가격 + 평점 + 잔여석 + CTA */}
      <div className="mt-3 md:mt-4 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-baseline gap-0.5">
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
        <div className="flex items-center gap-2">
          {pkg.avg_rating != null && pkg.review_count != null && pkg.review_count > 0 && (
            <span className="text-micro text-amber-500 font-semibold tabular-nums">
              ★ {Number(pkg.avg_rating).toFixed(1)}
              <span className="text-text-secondary font-normal ml-0.5">({pkg.review_count})</span>
            </span>
          )}
          {rankBadge && (
            <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-success-light text-success">
              {rankBadge}
            </span>
          )}
          <SeatBadge pkg={pkg} />
          {!rankBadge && (
            <span className="text-[11px] text-text-secondary/70 font-medium">일정 보기 →</span>
          )}
        </div>
      </div>
    </div>
  );
}
