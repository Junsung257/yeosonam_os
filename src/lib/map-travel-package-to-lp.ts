import type { PriceListItem } from '@/lib/parser';
import { normalizeDays } from '@/lib/attraction-matcher';
import { getEffectivePriceDates, getUpcomingPriceDates } from '@/lib/price-dates';
import { getKakaoChannelChatUrl } from '@/lib/kakaoChannel';
import { renderPackage, type CanonicalView } from '@/lib/render-contract';
import { extractLegalNoticeLinesFromPkg, extractSourcePreparationNoticeLinesFromPkg } from '@/lib/legal-notice';
import { buildRecommendationDisplay, type PackageScoreDisplayRow, type RecommendationDisplay } from '@/lib/scoring/recommendation-display';
import { normalizeCustomerVisibleCopy } from '@/lib/customer-copy-quality';
import { formatKstDate, isValidIsoDateKst } from '@/lib/kst-date';
import type { NormalizedOptionalTour } from '@/lib/itinerary-render';
import { buildCustomerPackageDisplayCopy } from '@/lib/customer-package-display-copy';
import { readRegistrationTermsPolicySnapshot, type NoticeBlock } from '@/lib/standard-terms-client';
import type { CustomerBudget } from '@/lib/package-publication/customer-budget';
import {
  normalizePublicPackageMedia,
  publicMediaFromLegacyUrl,
  selectPublicHeroMedia,
} from '@/lib/package-publication/public-media';
import type { PublicPackageMedia } from '@/lib/package-publication/types';

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
  /** Technical lineage markers used by the V5 cache-convergence observer.
   * They are not rendered in customer copy or exposed as business data. */
  publicSnapshotHash?: string;
  publicSnapshotRendererBuildId?: string | null;
  canonicalRevisionId?: string | null;
  termsPolicyHash?: string;
  frozenTermsNotices?: NoticeBlock[];
  internalCode?: string;
  destination: string;
  duration: string;
  heroImageA: string;
  heroImageB: string;
  heroMedia: PublicPackageMedia | null;
  scarcityRemaining: number | null;
  departureDateLabel: string;
  departureFullDate: string | null;
  deadlineDays: number | null;
  ticketingCondition: {
    status: 'open' | 'expired' | 'conditional' | 'conflicting';
    notice: string;
    consultationOnly: boolean;
  } | null;
  customMessage: Record<ChannelSource, ChannelMessage>;
  priceFrom: number;
  compareAtPrice: number | null;
  customerBudget?: CustomerBudget;
  price_list?: PriceListItem[];
  price_dates?: {
    date: string;
    price: number;
    child_price?: number;
    confirmed: boolean;
    list_price?: number;
    min_travelers?: number;
    max_travelers?: number;
    price_relation?: 'final_sale' | 'standard_sale';
    price_note?: string;
  }[];
  singleSupplement?: string;
  guideTrip?: string;
  kakaoChannelUrl: string;
  reviewCount: number;
  reviewScore: number;
  departureGuaranteed: boolean;
  recommendation?: RecommendationDisplay | null;
  flightSummary?: {
    outbound?: { code?: string | null; depTime?: string | null; arrTime?: string | null; depCity?: string | null; arrCity?: string | null; arrDayOffset?: number | null } | null;
    inbound?: { code?: string | null; depTime?: string | null; arrTime?: string | null; depCity?: string | null; arrCity?: string | null; arrDayOffset?: number | null } | null;
  };
  itinerary: {
    days: ItineraryDay[];
    alternatives: Array<{
      label: string;
      consultationSelectionRequired: boolean;
      days: ItineraryDay[];
    }>;
    highlights: string[];
    includes: string[];
    excludes: string[];
    optionalTours: NormalizedOptionalTour[];
    legalNotices: string[];
    sourcePreparationNotices: string[];
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

function mapRawItineraryDays(value: unknown): ItineraryDay[] {
  const rows = normalizeDays<Record<string, unknown>>(
    value as Parameters<typeof normalizeDays<Record<string, unknown>>>[0],
  );
  return rows.map((row): ItineraryDay => {
    const regions = asStringArray(row.regions);
    const meals = asRecord(row.meals);
    const hotel = asRecord(row.hotel);
    const schedule = Array.isArray(row.schedule)
      ? row.schedule as Array<{
          activity?: string | null;
          type?: string | null;
          note?: string | null;
          attraction_ids?: string[];
          attraction_names?: string[];
          entity_kind?: string | null;
          landing_sentence?: string | null;
        }>
      : [];
    return {
      day: Number(row.day) || 1,
      title: regions.length > 0 ? regions.join(' · ') : '상세 일정',
      regions: regions.join(' · '),
      meals: {
        breakfast: Boolean(meals?.breakfast),
        lunch: Boolean(meals?.lunch),
        dinner: Boolean(meals?.dinner),
      },
      activities: toLpActivities(schedule, regions),
      hotel: typeof hotel?.name === 'string' && hotel.name.trim()
        ? normalizeCustomerVisibleCopy(hotel.name)
        : undefined,
    };
  });
}

function readInternalCode(pkg: Record<string, unknown>): string | undefined {
  const products = pkg.products as
    | { internal_code?: string }
    | { internal_code?: string }[]
    | null
    | undefined;
  return Array.isArray(products) ? products[0]?.internal_code : products?.internal_code;
}

function readProductDisplayName(pkg: Record<string, unknown>): string | undefined {
  const products = pkg.products as
    | { display_name?: string | null }
    | Array<{ display_name?: string | null }>
    | null
    | undefined;
  return Array.isArray(products) ? products[0]?.display_name ?? undefined : products?.display_name ?? undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readCanonicalView(pkg: Record<string, unknown>): CanonicalView {
  const snapshotView = asRecord(pkg._canonical_view);
  if (snapshotView) return snapshotView as unknown as CanonicalView;
  return renderPackage(pkg);
}

function readLpProjection(pkg: Record<string, unknown>): Record<string, unknown> {
  return asRecord(pkg._lp_projection) ?? {};
}

function projectionString(projection: Record<string, unknown>, key: string): string | null {
  const value = projection[key];
  return typeof value === 'string' && value.trim() ? normalizeCustomerVisibleCopy(value) : null;
}

function projectionNumber(projection: Record<string, unknown>, key: string): number | null {
  const value = Number(projection[key]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function readCustomerBudget(
  pkg: Record<string, unknown>,
  projection: Record<string, unknown>,
): CustomerBudget | undefined {
  const source = asRecord(projection.customer_budget) ?? asRecord(pkg.customer_budget);
  const fuel = asRecord(source?.fuel_surcharge);
  const base = numericField(source?.base_product_price);
  const expected = source?.expected_budget == null ? null : numericField(source.expected_budget);
  const fuelAmount = fuel?.amount == null ? null : numericField(fuel.amount);
  const fuelStatus = typeof fuel?.status === 'string'
    && ['included', 'excluded_fixed', 'excluded_unpriced', 'conflicting', 'not_stated'].includes(fuel.status)
    ? fuel.status as CustomerBudget['fuel_surcharge']['status']
    : 'not_stated';
  if (!source || base == null) return undefined;
  return {
    currency: 'KRW',
    base_product_price: base,
    fuel_surcharge: {
      status: fuelStatus,
      amount: fuelAmount,
      source_text: typeof fuel?.source_text === 'string' ? fuel.source_text : null,
    },
    expected_budget: expected,
    expected_budget_display: typeof source.expected_budget_display === 'string'
      ? source.expected_budget_display
      : expected == null
        ? null
        : `${expected.toLocaleString('ko-KR')}원`,
    calculation: ['base_only', 'base_plus_fuel', 'fuel_confirmation_required', 'unavailable'].includes(String(source.calculation))
      ? source.calculation as CustomerBudget['calculation']
      : fuelStatus === 'excluded_fixed'
        ? 'base_plus_fuel'
        : 'base_only',
    guide_fee_excluded: source.guide_fee_excluded === true,
    guide_fee_source_text: typeof source.guide_fee_source_text === 'string'
      ? source.guide_fee_source_text
      : null,
  };
}

export function getExplicitSourceCompareAtPrice(
  rows: Array<{
    price: number;
    list_price?: number;
    price_relation?: 'final_sale' | 'standard_sale';
  }>,
  displayedPrice: number,
): number | null {
  const sourceDiscount = rows.find(row => (
    row.price === displayedPrice
    && row.price_relation === 'final_sale'
    && typeof row.list_price === 'number'
    && row.list_price > row.price
  ));
  return sourceDiscount?.list_price ?? null;
}

export function mapTravelPackageToLandingData(
  pkg: Record<string, unknown>,
  lpHeroImageUrl: string | null,
): LandingProductData {
  const view = readCanonicalView(pkg);
  const lpProjection = readLpProjection(pkg);
  const publicSnapshot = asRecord(pkg._public_snapshot);
  const publicSnapshotHash = typeof publicSnapshot?.snapshot_hash === 'string'
    && /^[0-9a-f]{64}$/i.test(publicSnapshot.snapshot_hash)
    ? publicSnapshot.snapshot_hash.toLowerCase()
    : undefined;
  const canonicalRevisionId = typeof publicSnapshot?.canonical_revision_id === 'string'
    && publicSnapshot.canonical_revision_id.trim()
    ? publicSnapshot.canonical_revision_id
    : null;
  const publicSnapshotRendererBuildId = typeof publicSnapshot?.renderer_build_id === 'string'
    && publicSnapshot.renderer_build_id.trim()
    ? publicSnapshot.renderer_build_id
    : null;
  const termsPolicy = readRegistrationTermsPolicySnapshot(pkg.terms_snapshot);
  const internalCode = readInternalCode(pkg);
  const cleanDestination = normalizeCustomerVisibleCopy(String(pkg.destination || '여행지')) || '여행지';
  const projectionHeroMedia = normalizePublicPackageMedia(lpProjection.hero_media, `${cleanDestination} 이미지`);
  const packageHeroMedia = normalizePublicPackageMedia(pkg.hero_media, `${cleanDestination} 이미지`)
    ?? selectPublicHeroMedia(pkg.images_public);
  const legacyHeroMedia = publicMediaFromLegacyUrl({
    url: lpHeroImageUrl,
    source: 'attraction_photo',
    role: 'hero',
    alt: `${cleanDestination} 참고 이미지`,
  });
  const heroMedia = projectionHeroMedia ?? packageHeroMedia ?? legacyHeroMedia;
  const displayCopy = buildCustomerPackageDisplayCopy({
    title: String(pkg.title || ''),
    display_title: typeof pkg.display_title === 'string' ? pkg.display_title : null,
    product_display_name: readProductDisplayName(pkg),
    hero_tagline: typeof pkg.hero_tagline === 'string' ? pkg.hero_tagline : null,
    product_summary: typeof pkg.product_summary === 'string' ? pkg.product_summary : null,
    destination: cleanDestination,
    duration: typeof pkg.duration === 'number' ? pkg.duration : null,
    nights: typeof pkg.nights === 'number' ? pkg.nights : null,
    trip_style: typeof pkg.trip_style === 'string' ? pkg.trip_style : null,
    product_type: typeof pkg.product_type === 'string' ? pkg.product_type : null,
    airline: typeof pkg.airline === 'string' ? pkg.airline : null,
    product_highlights: asStringArray(pkg.product_highlights),
    inclusions: asStringArray(pkg.inclusions),
    excludes: asStringArray(pkg.excludes),
    customer_notes: typeof pkg.customer_notes === 'string' ? pkg.customer_notes : null,
    optional_tours: Array.isArray(pkg.optional_tours)
      ? pkg.optional_tours as Array<{ name?: string | null; displayName?: string | null; note?: string | null }>
      : null,
  });

  const effectiveDates = getEffectivePriceDates(pkg as Parameters<typeof getEffectivePriceDates>[0]);
  const sortedDates = [...effectiveDates].filter(row => row.date).sort((a, b) => a.date.localeCompare(b.date));
  const todayStr = formatKstDate();
  const upcomingDates = getUpcomingPriceDates(sortedDates, todayStr);
  const upcoming = upcomingDates[0] ?? null;

  const priceNums = upcomingDates.map(row => row.price).filter((price): price is number => typeof price === 'number' && price > 0);
  const hasDatedSourcePrices = sortedDates.length > 0;
  const minPrice = hasDatedSourcePrices
    ? (priceNums.length > 0 ? Math.min(...priceNums) : 0)
    : projectionNumber(lpProjection, 'price') ?? 0;
  const customerBudget = readCustomerBudget(pkg, lpProjection);
  // A different departure date's higher selling price is not a crossed-out
  // list price. Show a comparison only when the same source price row carries
  // an explicit list-price -> final-sale relation.
  const compareAtPrice = getExplicitSourceCompareAtPrice(upcomingDates, minPrice);

  const held = typeof pkg.seats_held === 'number' ? pkg.seats_held : 0;
  const confirmed = typeof pkg.seats_confirmed === 'number' ? pkg.seats_confirmed : 0;
  const remaining = held > 0 ? held - confirmed : 0;
  const scarcityRemaining = remaining >= 1 && remaining <= 5 ? remaining : null;

  let deadlineDays: number | null = null;
  const ticketingDeadline = pkg.ticketing_deadline;
  const ticketingConditionRaw = asRecord(pkg.ticketing_condition);
  const ticketingStatusRaw = typeof pkg.ticketing_deadline_status === 'string'
    ? pkg.ticketing_deadline_status
    : typeof ticketingConditionRaw?.status === 'string'
      ? ticketingConditionRaw.status
      : null;
  const ticketingStatus = ['open', 'expired', 'conditional', 'conflicting'].includes(String(ticketingStatusRaw))
    ? ticketingStatusRaw as 'open' | 'expired' | 'conditional' | 'conflicting'
    : null;
  const ticketingNotice = typeof ticketingConditionRaw?.customerNotice === 'string'
    ? ticketingConditionRaw.customerNotice
    : ticketingStatus === 'expired'
      ? '발권기한 경과 · 현재 좌석과 요금 상담 확인'
      : null;
  const ticketingCondition = ticketingStatus && ticketingNotice
    ? {
        status: ticketingStatus,
        notice: ticketingNotice,
        consultationOnly: ticketingStatus === 'expired' || ticketingStatus === 'conflicting',
      }
    : null;
  if (ticketingStatus !== 'expired' && ticketingStatus !== 'conflicting' && ticketingDeadline && /^\d{4}-\d{2}-\d{2}/.test(String(ticketingDeadline))) {
    const deadline = new Date(`${String(ticketingDeadline).slice(0, 10)}T23:59:59`);
    const diff = Math.ceil((deadline.getTime() - Date.now()) / 86400000);
    if (diff >= 0 && diff <= 30) deadlineDays = diff;
  }

  const departureFullDate =
    upcoming?.date && isValidIsoDateKst(upcoming.date) ? upcoming.date : null;
  const departureDateLabel =
    upcoming?.date && isValidIsoDateKst(upcoming.date)
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
  const itineraryData = asRecord(pkg.itinerary_data);
  const itineraryAlternatives = Array.isArray(itineraryData?.itinerary_alternatives)
    ? itineraryData.itinerary_alternatives.flatMap((value) => {
        const alternative = asRecord(value);
        const label = typeof alternative?.label === 'string'
          ? normalizeCustomerVisibleCopy(alternative.label)
          : '';
        const days = mapRawItineraryDays(alternative?.days);
        return label && days.length > 0
          ? [{
              label,
              consultationSelectionRequired: alternative?.consultation_selection_required !== false,
              days,
            }]
          : [];
      })
    : [];
  const legalNotices = Array.from(new Set([
    ...extractLegalNoticeLinesFromPkg(pkg, 3),
    ...extractSourcePreparationNoticeLinesFromPkg(pkg, 12),
  ])).map(line => normalizeCustomerVisibleCopy(line));
  const sourcePreparationNotices = extractSourcePreparationNoticeLinesFromPkg(pkg, 12)
    .map(line => normalizeCustomerVisibleCopy(line));
  const duration = formatLandingDuration(pkg);

  return {
    id: String(pkg.id),
    publicSnapshotHash,
    publicSnapshotRendererBuildId,
    canonicalRevisionId,
    termsPolicyHash: termsPolicy?.policy_hash,
    frozenTermsNotices: termsPolicy?.notices,
    internalCode: internalCode || undefined,
    destination: cleanDestination,
    duration,
    heroImageA: heroMedia?.url ?? '',
    heroImageB: heroMedia?.url ?? '',
    heroMedia,
    scarcityRemaining,
    departureDateLabel,
    departureFullDate,
    deadlineDays,
    ticketingCondition,
    customMessage: {
      insta: {
        headline: `${cleanDestination}의\n추천 일정`,
        subline: displayCopy.cardTitle,
      },
      kakao: {
        headline: `${displayCopy.cardTitle}\n상담 문의가 많습니다`,
        subline: '전 일정 확인 · 항공/호텔 조건 상담 · 직판가 안내',
      },
      default: {
        headline: projectionString(lpProjection, 'title') ?? displayCopy.heroHeadline,
        subline: projectionString(lpProjection, 'subtitle')
          ?? projectionString(lpProjection, 'summary')
          ?? displayCopy.heroSubline
          ?? displayCopy.summaryLead,
      },
    },
    priceFrom: minPrice,
    compareAtPrice,
    customerBudget,
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
        arrDayOffset: view.flightHeader.outbound.arrDayOffset ?? null,
      } : null,
      inbound: view.flightHeader.inbound ? {
        code: view.flightHeader.inbound.code,
        depTime: view.flightHeader.inbound.depTime,
        arrTime: view.flightHeader.inbound.arrTime,
        depCity: view.flightHeader.inbound.depCity,
        arrCity: view.flightHeader.inbound.arrCity,
        arrDayOffset: view.flightHeader.inbound.arrDayOffset ?? null,
      } : null,
    },
    itinerary: {
      alternatives: itineraryAlternatives,
      highlights: asStringArray(pkg.product_highlights),
      includes: view.inclusions.flat.length > 0
        ? view.inclusions.flat.map(item => normalizeCustomerVisibleCopy(item))
        : asStringArray(pkg.inclusions),
      excludes: view.excludes.basic.length > 0
        ? view.excludes.basic.map(item => normalizeCustomerVisibleCopy(item))
        : asStringArray(pkg.excludes),
      optionalTours: view.optionalTours.flat.map(tour => ({
        ...tour,
        name: normalizeCustomerVisibleCopy(tour.name),
        displayName: normalizeCustomerVisibleCopy(tour.displayName),
        price: tour.price ? normalizeCustomerVisibleCopy(tour.price) : null,
        note: tour.note ? normalizeCustomerVisibleCopy(tour.note) : null,
      })),
      legalNotices,
      sourcePreparationNotices,
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
