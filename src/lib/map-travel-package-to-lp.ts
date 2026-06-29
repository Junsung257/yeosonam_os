import type { PriceListItem } from '@/lib/parser';
import { normalizeDays } from '@/lib/attraction-matcher';
import { getEffectivePriceDates } from '@/lib/price-dates';
import { getKakaoChannelChatUrl } from '@/lib/kakaoChannel';
import { renderPackage } from '@/lib/render-contract';
import { extractLegalNoticeLinesFromPkg } from '@/lib/legal-notice';
import { buildRecommendationDisplay, type PackageScoreDisplayRow, type RecommendationDisplay } from '@/lib/scoring/recommendation-display';
import { normalizeCustomerVisibleCopy } from '@/lib/customer-copy-quality';
import { formatKstDate, isUpcomingKstDate } from '@/lib/kst-date';

export type ChannelSource = 'insta' | 'kakao' | 'default';

export interface ChannelMessage {
  headline: string;
  subline: string;
}

export interface DayActivity {
  type: 'sightseeing' | 'meal' | 'hotel' | 'flight' | 'optional' | 'shopping' | 'transport';
  label: string;
  detail?: string;
  attractionIds?: string[];
  attractionNames?: string[];
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
  departureFullDate: string | null;
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
  recommendation?: RecommendationDisplay | null;
  flightSummary?: {
    outbound?: { code?: string | null; depTime?: string | null; arrTime?: string | null; depCity?: string | null; arrCity?: string | null } | null;
    inbound?: { code?: string | null; depTime?: string | null; arrTime?: string | null; depCity?: string | null; arrCity?: string | null } | null;
  };
  itinerary: {
    days: ItineraryDay[];
    highlights: string[];
    includes: string[];
    excludes: string[];
    legalNotices: string[];
  };
}

function toLpActivityType(type?: string | null): DayActivity['type'] {
  if (type === 'meal') return 'meal';
  if (type === 'hotel') return 'hotel';
  if (type === 'flight') return 'flight';
  if (type === 'optional') return 'optional';
  if (type === 'shopping') return 'shopping';
  if (type === 'train' || type === 'transfer') return 'transport';
  return 'sightseeing';
}

function toLpActivityTypeFromSchedule(type?: string | null, entityKind?: string | null): DayActivity['type'] {
  if (entityKind === 'transfer') return 'transport';
  if (entityKind === 'shopping') return 'shopping';
  if (entityKind === 'optional_tour') return 'optional';
  if (entityKind === 'hotel_stay') return 'hotel';
  if (entityKind === 'meal') return 'meal';
  if (entityKind === 'flight') return 'flight';
  return toLpActivityType(type);
}

function numericField(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeTripStyle(value: unknown): string | null {
  const match = String(value ?? '').trim().match(/(\d+)\s*박\s*(\d+)\s*일/);
  if (!match) return null;
  return `${Number(match[1])}박 ${Number(match[2])}일`;
}

function formatLandingDuration(pkg: Record<string, unknown>): string {
  const tripStyle = normalizeTripStyle(pkg.trip_style);
  if (tripStyle) return tripStyle;

  const itineraryData = pkg.itinerary_data as { meta?: { nights?: unknown; days?: unknown } } | null | undefined;
  const metaNights = numericField(itineraryData?.meta?.nights);
  const metaDays = numericField(itineraryData?.meta?.days);
  if (metaNights != null && metaDays != null && metaDays > 0) return `${metaNights}박 ${metaDays}일`;

  const nights = numericField(pkg.nights);
  const days = numericField(pkg.duration);
  if (nights != null && days != null && days > 0) return `${nights}박 ${days}일`;
  if (days != null && days > 0) return `${Math.max(0, days - 1)}박 ${days}일`;

  return '기간 미정';
}

function compact(value: string): string {
  return normalizeCustomerVisibleCopy(value).replace(/\s+/g, '').trim();
}

function isSupplierTableFragment(label: string, type: DayActivity['type'], attractionNames?: string[], regions?: string[]): boolean {
  const text = normalizeCustomerVisibleCopy(label);
  const compactText = compact(text);
  if (!compactText) return true;
  if ((attractionNames?.length ?? 0) > 0) return false;
  if ((regions ?? []).map(compact).includes(compactText)) return true;
  if (type === 'hotel' || type === 'optional' || type === 'shopping') return false;
  if (/^\d{1,2}:\d{2}$/.test(text)) return true;
  if (/^[A-Z0-9]{2}\d{3,4}$/i.test(compactText)) return true;
  if (/^\$?\d+/.test(text)) return true;
  if (/^(?:조|중|석)\s*:/.test(text)) return true;
  if (/^(?:호텔\s*)?(?:조식|중식|석식)\s*후$/.test(text)) return true;
  if (/^(?:부산|연길|도문|용정|북파|서파|전용차량|전일)$/.test(compactText)) return true;
  if (/^(?:호텔식|현지식|김밥|냉면|샤브샤브|삼겹살|양꼬치|비빔밥|무제한|매운탕)$/.test(compactText)) return true;
  return false;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => normalizeCustomerVisibleCopy(String(item))).filter(Boolean)
    : [];
}

function toLpActivities(
  schedule: {
    activity?: string | null;
    type?: string | null;
    note?: string | null;
    attraction_ids?: string[];
    attraction_names?: string[];
    entity_kind?: string | null;
    landing_sentence?: string | null;
  }[],
  regions?: string[],
): DayActivity[] {
  return schedule
    .map((item): DayActivity => {
      const type = toLpActivityTypeFromSchedule(item.type, item.entity_kind);
      const attractionNames = Array.isArray(item.attraction_names)
        ? item.attraction_names.map(name => normalizeCustomerVisibleCopy(name)).filter(Boolean)
        : undefined;
      return {
        type,
        label: normalizeCustomerVisibleCopy(item.landing_sentence || item.activity || ''),
        detail: item.note ? normalizeCustomerVisibleCopy(item.note) : undefined,
        attractionIds: Array.isArray(item.attraction_ids) ? item.attraction_ids.filter(Boolean) : undefined,
        attractionNames,
      };
    })
    .filter(activity => !isSupplierTableFragment(activity.label, activity.type, activity.attractionNames, regions));
}

function readInternalCode(pkg: Record<string, unknown>): string | undefined {
  const products = pkg.products as
    | { internal_code?: string }
    | { internal_code?: string }[]
    | null
    | undefined;
  return Array.isArray(products) ? products[0]?.internal_code : products?.internal_code;
}

export function mapTravelPackageToLandingData(
  pkg: Record<string, unknown>,
  lpHeroImageUrl: string | null,
): LandingProductData {
  const view = renderPackage(pkg);
  const internalCode = readInternalCode(pkg);
  const cleanTitle = normalizeCustomerVisibleCopy(String(pkg.title || ''));
  const cleanDestination = normalizeCustomerVisibleCopy(String(pkg.destination || '여행지')) || '여행지';
  const cleanSummary = normalizeCustomerVisibleCopy(String(pkg.product_summary || ''));

  const effectiveDates = getEffectivePriceDates(pkg as Parameters<typeof getEffectivePriceDates>[0]);
  const sortedDates = [...effectiveDates].filter(row => row.date).sort((a, b) => a.date.localeCompare(b.date));
  const todayStr = formatKstDate();
  const upcoming = sortedDates.find(row => isUpcomingKstDate(row.date, todayStr)) ?? sortedDates[0] ?? null;

  const priceNums = effectiveDates.map(row => row.price).filter((price): price is number => typeof price === 'number' && price > 0);
  const minPrice = priceNums.length > 0 ? Math.min(...priceNums) : (Number(pkg.price) || 0);
  const maxPrice = priceNums.length > 0 ? Math.max(...priceNums) : null;
  const compareAtPrice = maxPrice != null && maxPrice > minPrice ? maxPrice : null;

  const held = typeof pkg.seats_held === 'number' ? pkg.seats_held : 0;
  const confirmed = typeof pkg.seats_confirmed === 'number' ? pkg.seats_confirmed : 0;
  const remaining = held > 0 ? held - confirmed : 0;
  const scarcityRemaining = remaining >= 1 && remaining <= 5 ? remaining : null;

  let deadlineDays: number | null = null;
  const ticketingDeadline = pkg.ticketing_deadline;
  if (ticketingDeadline && /^\d{4}-\d{2}-\d{2}/.test(String(ticketingDeadline))) {
    const deadline = new Date(`${String(ticketingDeadline).slice(0, 10)}T23:59:59`);
    const diff = Math.ceil((deadline.getTime() - Date.now()) / 86400000);
    if (diff >= 0 && diff <= 30) deadlineDays = diff;
  }

  const departureFullDate =
    upcoming?.date && /^\d{4}-\d{2}-\d{2}/.test(upcoming.date) ? upcoming.date : null;
  const departureDateLabel =
    upcoming?.date && upcoming.date.length >= 10
      ? `${parseInt(upcoming.date.slice(5, 7), 10)}/${parseInt(upcoming.date.slice(8, 10), 10)}`
      : '미정';

  const scoreRows = Array.isArray(pkg._packageScores)
    ? (pkg._packageScores as PackageScoreDisplayRow[])
    : [];
  const scoreRow =
    scoreRows.find(row => row.departure_date === departureFullDate && (row.group_size ?? 0) >= 2)
    ?? scoreRows.find(row => (row.group_size ?? 0) >= 2)
    ?? scoreRows[0]
    ?? null;

  const dayRows = normalizeDays(pkg.itinerary_data as Parameters<typeof normalizeDays>[0]) as Record<string, unknown>[];
  const canonicalDays = view.days;
  const legalNotices = extractLegalNoticeLinesFromPkg(pkg, 3).map(line => normalizeCustomerVisibleCopy(line));
  const duration = formatLandingDuration(pkg);

  return {
    id: String(pkg.id),
    internalCode: internalCode || undefined,
    destination: cleanDestination,
    duration,
    heroImageA: lpHeroImageUrl || '',
    heroImageB: lpHeroImageUrl || '',
    scarcityRemaining,
    departureDateLabel,
    departureFullDate,
    deadlineDays,
    customMessage: {
      insta: {
        headline: `${cleanDestination}의\n아름다운 순간`,
        subline: cleanTitle,
      },
      kakao: {
        headline: `${cleanTitle}\n상담 문의가 많습니다`,
        subline: '전 일정 확인 · 항공/호텔 조건 상담 · 직판가 안내',
      },
      default: {
        headline: cleanTitle,
        subline: cleanSummary,
      },
    },
    priceFrom: minPrice,
    compareAtPrice,
    price_list: (pkg.price_list as PriceListItem[]) || [],
    price_dates:
      Array.isArray(pkg.price_dates) && (pkg.price_dates as unknown[]).length > 0
        ? (pkg.price_dates as LandingProductData['price_dates'])
        : effectiveDates,
    singleSupplement:
      pkg.single_supplement == null
        ? '별도문의'
        : typeof pkg.single_supplement === 'number'
          ? `${pkg.single_supplement.toLocaleString()}원`
          : normalizeCustomerVisibleCopy(String(pkg.single_supplement)),
    guideTrip: pkg.guide_tip ? `$${pkg.guide_tip}/인` : '별도문의',
    kakaoChannelUrl: getKakaoChannelChatUrl(),
    reviewCount: typeof pkg.review_count === 'number' ? pkg.review_count : 0,
    reviewScore: typeof pkg.avg_rating === 'number' ? pkg.avg_rating : 0,
    departureGuaranteed: effectiveDates.some(row => row.confirmed),
    recommendation: buildRecommendationDisplay(scoreRow),
    flightSummary: {
      outbound: view.flightHeader.outbound ? {
        code: view.flightHeader.outbound.code,
        depTime: view.flightHeader.outbound.depTime,
        arrTime: view.flightHeader.outbound.arrTime,
        depCity: view.flightHeader.outbound.depCity,
        arrCity: view.flightHeader.outbound.arrCity,
      } : null,
      inbound: view.flightHeader.inbound ? {
        code: view.flightHeader.inbound.code,
        depTime: view.flightHeader.inbound.depTime,
        arrTime: view.flightHeader.inbound.arrTime,
        depCity: view.flightHeader.inbound.depCity,
        arrCity: view.flightHeader.inbound.arrCity,
      } : null,
    },
    itinerary: {
      highlights: asStringArray(pkg.product_highlights),
      includes: view.inclusions.flat.length > 0
        ? view.inclusions.flat.map(item => normalizeCustomerVisibleCopy(item))
        : asStringArray(pkg.inclusions),
      excludes: view.excludes.basic.length > 0
        ? view.excludes.basic.map(item => normalizeCustomerVisibleCopy(item))
        : asStringArray(pkg.excludes),
      legalNotices,
      days: canonicalDays.length > 0
        ? canonicalDays.map((day): ItineraryDay => ({
            day: day.day,
            title: day.regions.length > 0 ? day.regions.map(region => normalizeCustomerVisibleCopy(region)).join(' · ') : '상세 일정',
            regions: day.regions.map(region => normalizeCustomerVisibleCopy(region)).join(' · '),
            meals: {
              breakfast: Boolean(day.meals?.breakfast),
              lunch: Boolean(day.meals?.lunch),
              dinner: Boolean(day.meals?.dinner),
            },
            activities: [
              ...toLpActivities(day.schedule, day.regions),
              ...(day.hotelCard?.name
                ? [{
                    type: 'hotel' as const,
                    label: `호텔: ${normalizeCustomerVisibleCopy(day.hotelCard.name)}`,
                    detail: day.hotelCard.note ? normalizeCustomerVisibleCopy(day.hotelCard.note) : undefined,
                  }]
                : []),
            ],
            hotel: day.hotelCard?.name ? normalizeCustomerVisibleCopy(day.hotelCard.name) : undefined,
          }))
        : dayRows.map((row): ItineraryDay => {
            const regions = asStringArray(row.regions);
            return {
              day: Number(row.day) || 1,
              title: regions.length > 0 ? regions.join(' · ') : '상세 일정',
              regions: regions.join(' · '),
              meals: (row.meals as ItineraryDay['meals']) || {
                breakfast: false,
                lunch: false,
                dinner: false,
              },
              activities: toLpActivities((row.schedule as {
                activity: string;
                type?: string;
                note?: string;
                attraction_ids?: string[];
                attraction_names?: string[];
                entity_kind?: string | null;
                landing_sentence?: string | null;
              }[]) || [], regions),
              hotel: (row.hotel as { name?: string } | null)?.name
                ? normalizeCustomerVisibleCopy((row.hotel as { name: string }).name)
                : undefined,
            };
          }),
    },
  };
}
