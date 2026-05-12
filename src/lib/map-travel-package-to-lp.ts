/**
 * travel_packages 행 → LP(랜딩)용 직렬화 데이터. 서버·API 공통.
 */
import type { PriceListItem } from '@/lib/parser';
import { normalizeDays } from '@/lib/attraction-matcher';
import { getEffectivePriceDates } from '@/lib/price-dates';
import { getKakaoChannelChatUrl } from '@/lib/kakaoChannel';
import { renderPackage } from '@/lib/render-contract';
import { extractLegalNoticeLinesFromPkg } from '@/lib/legal-notice';

export type ChannelSource = 'insta' | 'kakao' | 'default';

export interface ChannelMessage {
  headline: string;
  subline: string;
}

export interface DayActivity {
  type: 'sightseeing' | 'meal' | 'hotel' | 'flight' | 'optional' | 'shopping' | 'transport';
  label: string;
  detail?: string;
}

export interface ItineraryDay {
  day: number;
  title: string;
  regions: string;
  meals: { breakfast: boolean; lunch: boolean; dinner: boolean };
  activities: DayActivity[];
  hotel?: string;
}

export interface LandingProductData {
  id: string;
  internalCode?: string;
  destination: string;
  duration: string;
  heroImageA: string;
  heroImageB: string;
  scarcityRemaining: number | null;
  departureDateLabel: string;
  departureFullDate: string;
  deadlineDays: number | null;
  customMessage: Record<ChannelSource, ChannelMessage>;
  priceFrom: number;
  compareAtPrice: number | null;
  price_list?: PriceListItem[];
  price_dates?: { date: string; price: number; child_price?: number; confirmed: boolean }[];
  singleSupplement?: string;
  guideTrip?: string;
  kakaoChannelUrl: string;
  reviewCount: number;
  reviewScore: number;
  departureGuaranteed: boolean;
  itinerary: {
    days: ItineraryDay[];
    highlights: string[];
    includes: string[];
    excludes: string[];
    legalNotices: string[];
  };
}

function toLpActivityType(type?: string | null): DayActivity['type'] {
  if (!type) return 'sightseeing';
  if (type === 'meal') return 'meal';
  if (type === 'hotel') return 'hotel';
  if (type === 'flight') return 'flight';
  if (type === 'optional') return 'optional';
  if (type === 'shopping') return 'shopping';
  if (type === 'train') return 'transport';
  if (type === 'normal') return 'sightseeing';
  return 'sightseeing';
}

/** 서버에서만 호출 — 채팅 URL 은 env 채널 ID 기준 */
export function mapTravelPackageToLandingData(
  pkg: Record<string, unknown>,
  lpHeroImageUrl: string | null,
): LandingProductData {
  const view = renderPackage(pkg);
  const products = pkg.products as
    | { internal_code?: string }
    | { internal_code?: string }[]
    | null
    | undefined;
  const internalCode = Array.isArray(products)
    ? products[0]?.internal_code
    : products?.internal_code;

  const eff = getEffectivePriceDates(pkg as Parameters<typeof getEffectivePriceDates>[0]);
  const sortedDates = [...eff].filter(d => d.date).sort((a, b) => a.date.localeCompare(b.date));
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcoming = sortedDates.find(d => d.date >= todayStr) ?? sortedDates[0];

  const priceNums = eff.map(d => d.price).filter((p): p is number => typeof p === 'number' && p > 0);
  const minPrice = priceNums.length > 0 ? Math.min(...priceNums) : (Number(pkg.price) || 0);
  const maxPrice = priceNums.length > 0 ? Math.max(...priceNums) : null;
  const compareAtPrice = maxPrice != null && maxPrice > minPrice ? maxPrice : null;

  const held = typeof pkg.seats_held === 'number' ? pkg.seats_held : 0;
  const confirmed = typeof pkg.seats_confirmed === 'number' ? pkg.seats_confirmed : 0;
  const remaining = held > 0 ? held - confirmed : 0;
  const scarcityRemaining = remaining >= 1 && remaining <= 5 ? remaining : null;

  let deadlineDays: number | null = null;
  const tick = pkg.ticketing_deadline;
  if (tick && /^\d{4}-\d{2}-\d{2}/.test(String(tick))) {
    const tStr = String(tick).slice(0, 10);
    const end = new Date(`${tStr}T23:59:59`);
    const now = new Date();
    const diff = Math.ceil((end.getTime() - now.getTime()) / 86400000);
    if (diff >= 0 && diff <= 30) deadlineDays = diff;
  }

  const rc = typeof pkg.review_count === 'number' ? pkg.review_count : 0;
  const rs = typeof pkg.avg_rating === 'number' ? pkg.avg_rating : 0;
  const heroUrl = lpHeroImageUrl || '';

  const departureFullDate =
    upcoming?.date && /^\d{4}-\d{2}-\d{2}/.test(upcoming.date) ? upcoming.date : todayStr;
  const departureDateLabel =
    upcoming?.date && upcoming.date.length >= 10
      ? `${parseInt(upcoming.date.slice(5, 7), 10)}/${parseInt(upcoming.date.slice(8, 10), 10)}`
      : '미정';

  const durationNum = pkg.duration as number | undefined;
  const duration = durationNum ? `${durationNum - 1}박 ${durationNum}일` : '기간 미정';

  // A4·모바일 상세·LP 동일 규칙: 문자열 JSON·day_list·순수 배열 등
  const dayRows = normalizeDays(
    pkg.itinerary_data as Parameters<typeof normalizeDays>[0],
  ) as Record<string, unknown>[];
  const canonicalDays = view.days;
  const legalNotices = extractLegalNoticeLinesFromPkg(pkg, 3);

  return {
    id: String(pkg.id),
    internalCode: internalCode || undefined,
    destination: (pkg.destination as string) || '여행지',
    duration,
    heroImageA: heroUrl,
    heroImageB: heroUrl,
    scarcityRemaining,
    departureDateLabel,
    departureFullDate,
    deadlineDays,
    customMessage: {
      insta: {
        headline: `${pkg.destination || '여행지'}의\n아름다운 순간`,
        subline: String(pkg.title || ''),
      },
      kakao: {
        headline: `${pkg.title || ''}\n상담문의가 많습니다`,
        subline: '전 일정 정품 호텔 · 직항 · 직판 최저가 보장',
      },
      default: {
        headline: String(pkg.title || ''),
        subline: String(pkg.product_summary || ''),
      },
    },
    priceFrom: minPrice,
    compareAtPrice,
    price_list: (pkg.price_list as PriceListItem[]) || [],
    price_dates:
      Array.isArray(pkg.price_dates) && (pkg.price_dates as unknown[]).length > 0
        ? (pkg.price_dates as LandingProductData['price_dates'])
        : eff,
    singleSupplement:
      pkg.single_supplement == null
        ? '별도문의'
        : typeof pkg.single_supplement === 'number'
          ? `${pkg.single_supplement.toLocaleString()}원`
          : String(pkg.single_supplement),
    guideTrip: pkg.guide_tip ? `$${pkg.guide_tip}/인` : '별도문의',
    kakaoChannelUrl: getKakaoChannelChatUrl(),
    reviewCount: rc,
    reviewScore: rs,
    departureGuaranteed: eff.some(d => d.confirmed),
    itinerary: {
      highlights: (pkg.product_highlights as string[]) || [],
      includes: view.inclusions.flat.length > 0
        ? view.inclusions.flat
        : ((pkg.inclusions as string[]) || []),
      excludes: view.excludes.basic.length > 0
        ? view.excludes.basic
        : ((pkg.excludes as string[]) || []),
      legalNotices,
      days: (canonicalDays.length > 0
        ? canonicalDays.map((d): ItineraryDay => ({
            day: d.day,
            title: d.regions.length > 0 ? d.regions.join(' · ') : '상세 일정',
            regions: d.regions.join(' · '),
            meals: {
              breakfast: !!d.meals?.breakfast,
              lunch: !!d.meals?.lunch,
              dinner: !!d.meals?.dinner,
            },
            activities: [
              ...d.schedule.map(s => ({
                type: toLpActivityType(s.type),
                label: s.activity ?? '',
                detail: s.note ?? undefined,
              })),
              ...(d.hotelCard?.name
                ? [{
                    type: 'hotel' as const,
                    label: `호텔: ${d.hotelCard.name}`,
                    detail: d.hotelCard.note ?? undefined,
                  }]
                : []),
            ],
            hotel: d.hotelCard?.name ?? undefined,
          }))
        : dayRows.map((row): ItineraryDay => {
            const d = row as Record<string, unknown>;
            return {
              day: d.day as number,
              title: (Array.isArray(d.regions) ? (d.regions as string[]).join(' · ') : '') || '상세 일정',
              regions: Array.isArray(d.regions) ? (d.regions as string[]).join(' · ') : '',
              meals: (d.meals as ItineraryDay['meals']) || {
                breakfast: false,
                lunch: false,
                dinner: false,
              },
              activities: ((d.schedule as { activity: string; type?: string; note?: string }[]) || []).map(
                s => ({
                  type: toLpActivityType(s.type),
                  label: s.activity,
                  detail: s.note,
                }),
              ),
              hotel: (d.hotel as { name?: string } | null)?.name,
            };
          })),
    },
  };
}
