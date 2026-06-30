/**
 * @file auto-mobile-qa.ts
 * @description 등록 직후 모바일 페이지를 fetch → HTML 검증 → ai_quality_log 적재.
 *
 * 박제 사유 (2026-05-13): 푸꾸옥 등록 사고에서 V2 confidence 0.905 라 보고됐지만
 * 모바일 페이지에 노출된 결함(투어비 9%, notices 빈 화면)이 실제로는 78%.
 * → 실제 렌더 결과를 자동 점검해서 V2 산식과의 gap 을 잡아야 함.
 *
 * 동작:
 *   1. ISR revalidate 호출 (페이지 캐시 무효화)
 *   2. 페이지 fetch (HTML)
 *   3. 정규식 검사: leak 패턴 + 누락 검사
 *   4. ai_quality_log.failed_checks 에 추가 누락 적재
 *
 * fail-soft: 모든 단계 catch → 로깅만, 등록 자체엔 영향 없음.
 */

import { supabaseAdmin, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/supabase';
import { LEAK_PATTERNS } from '@/lib/customer-leak-sanitizer';
import { isCustomerVisibleStatus } from '@/lib/visibility-status';
import { getSecret } from '@/lib/secret-registry';
import {
  hashSourceText,
  normalizeBlockerSignature,
  type ImprovementLedgerEvent,
} from '@/lib/product-registration/improvement-ledger';
import { persistImprovementLedgerEvents } from '@/lib/product-registration/improvement-ledger-persistence';

export interface QAIncident {
  id: string;
  severity: 'critical' | 'high' | 'medium';
  message: string;
}

type ItineraryDay = {
  hotel?: { name?: string | null } | null;
  schedule?: Array<{
    activity?: string | null;
    type?: string | null;
    attraction_names?: unknown;
    attraction_ids?: unknown;
  }> | null;
};

export type ExpectedRender = {
  title: string | null;
  destination: string | null;
  tripStyle: string | null;
  duration: number | null;
  nights: number | null;
  requiresFlightCard: boolean;
  hotelNames: string[];
  hasOptionalTours: boolean;
  status: string | null;
  shortCode: string | null;
  internalCode: string | null;
  rawText: string | null;
  updatedAt?: string | null;
  lastDayNumber: number | null;
  lastDayArrivalCity: string | null;
  homeCity: string | null;
  currentAttractionMatchedCount?: number;
  currentAttractionUnmatchedCount?: number;
};

const AUTO_QA_CHECK_PREFIXES = [
  'mobile_',
  'lp_',
  'mobile_attraction_',
];

function isAutoQACheck(check: unknown): boolean {
  const id = typeof check === 'object' && check !== null && 'id' in check
    ? String((check as { id?: unknown }).id ?? '')
    : '';
  return AUTO_QA_CHECK_PREFIXES.some(prefix => id.startsWith(prefix));
}

async function loadExpectedRender(packageId: string): Promise<ExpectedRender> {
  const empty: ExpectedRender = {
    title: null,
    destination: null,
    tripStyle: null,
    duration: null,
    nights: null,
    requiresFlightCard: true,
    hotelNames: [],
    hasOptionalTours: false,
    status: null,
    shortCode: null,
    internalCode: null,
    rawText: null,
    updatedAt: null,
    lastDayNumber: null,
    lastDayArrivalCity: null,
    homeCity: null,
    currentAttractionMatchedCount: 0,
    currentAttractionUnmatchedCount: 0,
  };
  try {
    const { data } = await supabaseAdmin
      .from('travel_packages')
      .select('title, display_title, destination, duration, nights, trip_style, product_type, airline, departure_airport, itinerary_data, optional_tours, status, short_code, internal_code, raw_text, updated_at')
      .eq('id', packageId)
      .maybeSingle();
    if (!data) {
      return empty;
    }

    const title = (data as { display_title?: string | null; title?: string | null }).display_title
      || (data as { title?: string | null }).title
      || null;

    const days: ItineraryDay[] = Array.isArray((data as { itinerary_data?: { days?: ItineraryDay[] } }).itinerary_data?.days)
      ? ((data as { itinerary_data: { days: ItineraryDay[] } }).itinerary_data.days)
      : [];
    const lastDay = days.at(-1) as (ItineraryDay & { day?: number; schedule?: Array<{ activity?: string | null; type?: string | null }> }) | undefined;
    const lastArrival = lastDay?.schedule?.find(item =>
      item?.type === 'flight'
      && /도착/.test(String(item.activity ?? ''))
      && !/출발|향발/.test(String(item.activity ?? '')),
    );
    const lastDayArrivalCity = extractCityFromArrival(String(lastArrival?.activity ?? ''));
    const homeCity = String((data as { departure_airport?: string | null }).departure_airport ?? '')
      .replace(/\s*(국제)?공항.*$/, '')
      .trim() || lastDayArrivalCity;
    // 마지막 날은 hotel.name null 정상 (귀국일). 0..N-2 만 검사 대상.
    const hotelNames = days
      .slice(0, Math.max(0, days.length - 1))
      .map(d => (d?.hotel?.name ?? '').trim())
      .filter(n => n.length >= 2);

    const tours = (data as { optional_tours?: unknown[] }).optional_tours;
    const hasOptionalTours = Array.isArray(tours) && tours.length > 0;
    const itineraryData = (data as { itinerary_data?: { flight_segments?: unknown[] } }).itinerary_data;
    const requiresFlightCard = shouldRequireFlightCard({
      rawText: (data as { raw_text?: string | null }).raw_text ?? null,
      airline: (data as { airline?: string | null }).airline ?? null,
      productType: (data as { product_type?: string | null }).product_type ?? null,
      flightSegments: Array.isArray(itineraryData?.flight_segments) ? itineraryData.flight_segments : [],
    });
    let currentAttractionMatchedCount = 0;
    let currentAttractionUnmatchedCount = 0;
    for (const day of days) {
      for (const item of day.schedule ?? []) {
        const names = Array.isArray(item?.attraction_names) ? item.attraction_names.filter(Boolean) : [];
        if (names.length === 0) continue;
        const ids = Array.isArray(item?.attraction_ids) ? item.attraction_ids.filter(Boolean) : [];
        currentAttractionMatchedCount += Math.min(names.length, ids.length);
        currentAttractionUnmatchedCount += Math.max(0, names.length - ids.length);
      }
    }

    return {
      title,
      destination: (data as { destination?: string | null }).destination ?? null,
      tripStyle: (data as { trip_style?: string | null }).trip_style ?? null,
      duration: typeof (data as { duration?: unknown }).duration === 'number' ? (data as { duration: number }).duration : null,
      nights: typeof (data as { nights?: unknown }).nights === 'number' ? (data as { nights: number }).nights : null,
      requiresFlightCard,
      hotelNames,
      hasOptionalTours,
      status: (data as { status?: string | null }).status ?? null,
      shortCode: (data as { short_code?: string | null }).short_code ?? null,
      internalCode: (data as { internal_code?: string | null }).internal_code ?? null,
      rawText: (data as { raw_text?: string | null }).raw_text ?? null,
      updatedAt: (data as { updated_at?: string | null }).updated_at ?? null,
      lastDayNumber: typeof lastDay?.day === 'number' ? lastDay.day : days.length || null,
      lastDayArrivalCity,
      homeCity,
      currentAttractionMatchedCount,
      currentAttractionUnmatchedCount,
    };
  } catch {
    return empty;
  }
}

const AIR_TRANSPORT_RE = /\b(?:[A-Z][A-Z0-9]|[0-9][A-Z])\s*\d{3,4}\b|flight|airline|airport|\uD56D\uACF5|\uBE44\uD589|\uD3B8\uBA85|\uCD9C\uBC1C\uD3B8|\uADC0\uAD6D\uD3B8|\uACF5\uD56D|\uAD6D\uC81C\uACF5\uD56D/i;
const NON_AIR_TRANSPORT_RE = /ferry|cruise|\uD6FC\uB9AC|\uD398\uB9AC|\uC120\uBC15|\uD06C\uB8E8\uC988|\uBD80\uAD00\uD6FC\uB9AC|\uB274\uCE74\uBA5C\uB9AC\uC544|\uCE74\uBA5C\uB9AC\uC544|\uBD80\uC0B0\uD56D|\uD558\uCE74\uB2E4\uD56D/i;

function shouldRequireFlightCard(input: {
  rawText: string | null;
  airline: string | null;
  productType: string | null;
  flightSegments: unknown[];
}): boolean {
  const haystack = [input.rawText, input.airline, input.productType].filter(Boolean).join(' ');
  if (/^(?:ferry|cruise)$/i.test(String(input.productType ?? ''))) return false;
  if (input.flightSegments.length > 0) return true;
  if (NON_AIR_TRANSPORT_RE.test(haystack) && !AIR_TRANSPORT_RE.test(haystack)) return false;
  return AIR_TRANSPORT_RE.test(haystack);
}

function parseTripStyle(value: string | null | undefined): { nights: number; days: number } | null {
  const match = String(value ?? '').match(/(\d+)\s*박\s*(\d+)\s*일/);
  return match ? { nights: Number(match[1]), days: Number(match[2]) } : null;
}

function extractCityFromArrival(activity: string): string | null {
  const match = activity
    .replace(/^[A-Z0-9]{2,5}\s+/, '')
    .match(/^(.+?)(?:국제)?공항?\s*도착/);
  return match?.[1]?.trim() || null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function isApplicationErrorHtml(html: string, text: string): boolean {
  return /Application error|client-side exception|server-side exception|FUNCTION_INVOCATION_TIMEOUT|Internal Server Error/i.test(html)
    || /Application error|client-side exception|server-side exception|Internal Server Error/i.test(text);
}

function missingCustomerLandingMarkers(text: string): string[] {
  const markerGroups = [
    {
      label: 'price',
      markers: ['\ud310\ub9e4\uac00', '\uc694\uae08\ud45c', '\ucd9c\ubc1c\uc77c \uc120\ud0dd'],
    },
    {
      label: 'itinerary',
      markers: ['\uc5ec\ud589 \uc77c\uc815', '\uc77c\uc815\ud45c', 'DAY 1'],
    },
    {
      label: 'booking',
      markers: ['\uc608\uc57d \ubb38\uc758', '\uce74\ud1a1 \uc0c1\ub2f4'],
    },
  ];

  return markerGroups
    .filter((group) => !includesAny(text, group.markers))
    .map((group) => group.label);
}

function extractCoreTitleTokens(title: string): string[] {
  // "★스팟특가★ 부산出 보홀 PKG 5/6일 [제주항공]" → ["보홀", "제주항공"] 같은 핵심 명사.
  // 한국어 명사 길이 2자 이상 / 영문 3자 이상 토큰만.
  const clean = title.replace(/[★☆▶◆●○※\[\]()\/\-_,．.·]+/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = clean.split(' ').filter(t => {
    if (/^\d+/.test(t)) return false;                       // "5/6일" 같은 숫자 토큰 제외
    if (/^[가-힣]{2,}$/.test(t)) return true;
    if (/^[A-Za-z]{3,}$/.test(t)) return true;
    return false;
  });
  // 너무 일반적 단어 제거
  const stopwords = new Set(['일정표', 'PKG', 'pkg', '특가', '스팟', '여행', '패키지', '상품']);
  return tokens.filter(t => !stopwords.has(t)).slice(0, 4);
}

function buildRevalidatePaths(packageId: string, shortCode?: string | null): string[] {
  const paths = [`/packages/${packageId}`, `/m/packages/${packageId}`, `/lp/${packageId}`];
  if (shortCode && shortCode !== packageId) paths.push(`/lp/${shortCode}`);
  return paths;
}

function finalDayTextWindow(text: string, dayNumber: number): string {
  const dayMarker = `DAY ${dayNumber}`;
  const dayIndex = text.lastIndexOf(dayMarker);
  if (dayIndex < 0) return '';
  const rest = text.slice(dayIndex + dayMarker.length);
  const nextDayOffset = rest.search(/\bDAY\s+\d+\b/);
  const end = nextDayOffset >= 0 ? dayIndex + dayMarker.length + nextDayOffset : dayIndex + 900;
  return text.slice(dayIndex, end);
}

function includesDeparturePhrase(text: string, city: string): boolean {
  const escapedCity = city
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s*');
  return new RegExp(`${escapedCity}\\s*\\uCD9C\\uBC1C`).test(text);
}

function clearStaleMobileQaFailures(report: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const clean = report && typeof report === 'object' && !Array.isArray(report) ? { ...report } : {};
  delete clean.incidents;
  delete clean.mobile_browser_proof_required;
  return clean;
}

function normalizeHotelMatchText(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/[()（）\[\]{}·.,]/g, '')
    .toLowerCase();
}

function hotelEvidenceTokens(hotelName: string): string[] {
  const stopWords = new Set([
    '\uD638\uD154',
    '\uB9AC\uC870\uD2B8',
    '\uBE4C\uB77C',
    '\uB808\uC9C0\uB358\uC2A4',
    '\uB3D9\uAE09',
    'hotel',
    'resort',
    'villa',
    'residence',
  ]);
  const chunks = hotelName
    .split(/\s*\/\s*|\s*,\s*|\s*\uB610\uB294\s*|\s+or\s+/i)
    .map(chunk => chunk.replace(/\([^)]*\)/g, ' ').trim())
    .filter(Boolean);
  const tokens = new Set<string>();
  for (const chunk of chunks) {
    const words = chunk.match(/[\uAC00-\uD7A3A-Za-z0-9&]+/g) ?? [];
    for (const word of words) {
      const normalized = normalizeHotelMatchText(word);
      if (normalized.length < 2 || stopWords.has(normalized)) continue;
      tokens.add(normalized);
      break;
    }
  }
  return [...tokens];
}

function isHotelVisibleInHtml(hotelName: string, html: string, text: string): boolean {
  if (html.includes(hotelName) || text.includes(hotelName)) return true;
  const normalizedPage = normalizeHotelMatchText(`${html} ${text}`);
  const tokens = hotelEvidenceTokens(hotelName);
  if (tokens.length === 0) return false;
  const matched = tokens.filter(token => normalizedPage.includes(token)).length;
  return tokens.length === 1 ? matched === 1 : matched >= Math.min(2, tokens.length);
}

function buildMobileBrowserProofPayload(input: {
  status: 'pass' | 'fail';
  checkedAt: string;
  packageUpdatedAt: string | null | undefined;
  surfaces: Array<{ surface: 'packages' | 'lp' }>;
  surfaceProofResults: Array<{
    surface: 'packages' | 'lp';
    status: 'pass';
    page_url: string;
    screen_hash: string;
    customer_visible_hash: string;
  }>;
}) {
  return {
    source: 'hwp-mobile-browser-proof',
    status: input.status,
    checked_at: input.checkedAt,
    package_updated_at: input.packageUpdatedAt,
    surfaces: input.surfaces.map(item => item.surface),
    screen_hash: hashSourceText(input.surfaceProofResults.map(item => `${item.surface}:${item.screen_hash}`).join('|')),
    customer_visible_hash: hashSourceText(input.surfaceProofResults.map(item => `${item.surface}:${item.customer_visible_hash}`).join('|')),
    surface_results: input.surfaceProofResults,
  };
}

export function analyzeMobileHtml(
  html: string,
  expected: ExpectedRender,
  surface: 'packages' | 'lp',
): QAIncident[] {
  const prefix = surface === 'lp' ? 'lp_' : 'mobile_';
  const incidents: QAIncident[] = [];
  const text = htmlToText(html);

  if (isApplicationErrorHtml(html, text)) {
    incidents.push({
      id: `${prefix}application_error_html`,
      severity: 'critical',
      message: `[${surface}] actual customer page rendered an application error page`,
    });
    return incidents;
  }

  if (surface === 'packages') {
    const missingMarkers = missingCustomerLandingMarkers(text);
    if (missingMarkers.length > 0) {
      incidents.push({
        id: `${prefix}customer_landing_core_markers_missing`,
        severity: missingMarkers.length >= 2 ? 'critical' : 'high',
        message: `[${surface}] customer landing core sections missing: ${missingMarkers.join(', ')}`,
      });
    }
  }

  for (const rule of LEAK_PATTERNS) {
    const match = text.match(rule.pattern);
    if (match && match.length > 0) {
      if (rule.id === 'room_pax_config') continue;
      incidents.push({
        id: `${prefix}leak_${rule.id}`,
        severity: rule.severity,
        message: `[${surface}] HTML leak (${rule.description}): "${match[0]}"`,
      });
    }
  }

  const hasNoticesSection = /유의사항|중요\s*공지|결제\s*조건|현장\s*규정/.test(html);
  const bulletCount = (html.match(/[•▶]\s/g) ?? []).length;
  if (hasNoticesSection && bulletCount < 3) {
    incidents.push({
      id: `${prefix}notices_empty`,
      severity: 'high',
      message: `[${surface}] 유의사항 섹션 비어 보임 (불렛 ${bulletCount}개)`,
    });
  }

  const hasFlightCard = /가는편|오는편/.test(html);
  if (expected.requiresFlightCard && !hasFlightCard) {
    incidents.push({
      id: `${prefix}flight_card_missing`,
      severity: 'high',
      message: `[${surface}] 항공편 카드 (가는편/오는편) 누락`,
    });
  } else if (expected.requiresFlightCard) {
    const flightTimes = html.match(/\b\d{1,2}:\d{2}\b/g) ?? [];
    if (flightTimes.length < 2) {
      incidents.push({
        id: `${prefix}flight_time_merged`,
        severity: 'high',
        message: `[${surface}] 항공편 출/도 시간 분리 안됨 (시간 토큰 ${flightTimes.length}개)`,
      });
    }
  }

  if (expected.title) {
    const tokens = extractCoreTitleTokens(expected.title);
    const missing = tokens.filter(t => !html.includes(t));
    if (tokens.length > 0 && missing.length === tokens.length) {
      incidents.push({
        id: `${prefix}hero_title_missing`,
        severity: 'critical',
        message: `[${surface}] hero 제목 핵심 토큰 모두 누락 (expected: ${tokens.join('·')})`,
      });
    } else if (missing.length > tokens.length / 2 && tokens.length >= 2) {
      incidents.push({
        id: `${prefix}hero_title_partial`,
        severity: 'medium',
        message: `[${surface}] hero 제목 일부 누락 (missing: ${missing.join('·')})`,
      });
    }
  }

  if (expected.hotelNames.length > 0) {
    const uniqueHotelNames = [...new Set(expected.hotelNames)];
    const missingHotels = uniqueHotelNames.filter(h => !isHotelVisibleInHtml(h, html, text));
    if (missingHotels.length === uniqueHotelNames.length) {
      incidents.push({
        id: `${prefix}hotel_all_missing`,
        severity: 'critical',
        message: `[${surface}] 모든 호텔명 렌더 누락 (${expected.hotelNames.length}개)`,
      });
    } else if (missingHotels.length > 0) {
      incidents.push({
        id: `${prefix}hotel_partial_missing`,
        severity: 'high',
        message: `[${surface}] 호텔명 일부 누락: ${missingHotels.slice(0, 3).join(', ')}${missingHotels.length > 3 ? ' …' : ''}`,
      });
    }
  }

  if (expected.hasOptionalTours && !/선택\s*관광|Optional|옵션\s*투어/.test(html)) {
    incidents.push({
      id: `${prefix}optional_tours_missing`,
      severity: 'high',
      message: `[${surface}] optional_tours DB 에 있으나 섹션 미렌더`,
    });
  }
  if (expected.hasOptionalTours && /추천\s*선택\s*관광/.test(text)) {
    incidents.push({
      id: `${prefix}optional_tours_duplicated_in_schedule`,
      severity: 'high',
      message: `[${surface}] 선택관광이 일정 본문과 선택관광 섹션에 중복 노출됨`,
    });
  }

  const trip = parseTripStyle(expected.tripStyle);
  if (trip) {
    const wrongDefaultNightLabel = `${trip.days - 1}박 ${trip.days}일`;
    if (trip.nights !== trip.days - 1 && text.includes(wrongDefaultNightLabel)) {
      incidents.push({
        id: `${prefix}duration_trip_style_wrong_default`,
        severity: 'critical',
        message: `[${surface}] trip_style=${expected.tripStyle} 인데 ${wrongDefaultNightLabel}로 렌더됨`,
      });
    }
    const dayOnlyChip = `#${trip.days}일`;
    const expectedChip = `#${trip.nights}박${trip.days}일`;
    if (surface === 'packages' && text.includes(dayOnlyChip) && !text.includes(expectedChip)) {
      incidents.push({
        id: `${prefix}duration_day_only_chip`,
        severity: 'high',
        message: `[${surface}] 기간 칩이 ${expectedChip} 대신 ${dayOnlyChip}로 렌더됨`,
      });
    }
  }

  if (expected.lastDayNumber && expected.homeCity && expected.lastDayArrivalCity) {
    const dayText = finalDayTextWindow(text, expected.lastDayNumber);
    if (includesDeparturePhrase(dayText, expected.homeCity) || includesDeparturePhrase(dayText, expected.lastDayArrivalCity)) {
      incidents.push({
        id: `${prefix}final_arrival_rendered_as_departure`,
        severity: 'critical',
        message: `[${surface}] final DAY arrival row rendered as a departure phrase (${expected.lastDayArrivalCity} arrival expected)`,
      });
    }
  }

  if (expected.destination && !/<img\b|_next\/image|images\.pexels\.com|supabase\.co\/storage/i.test(html)) {
    incidents.push({
      id: `${prefix}hero_image_missing`,
      severity: surface === 'packages' ? 'high' : 'medium',
      message: `[${surface}] 고객 첫 화면 대표 이미지가 감지되지 않음`,
    });
  }

  if (/\b배포\b|문서배포|자료배포|\d{1,2}\s*\/\s*까지/.test(text)) {
    incidents.push({
      id: `${prefix}customer_copy_internal_distribution_leak`,
      severity: 'high',
      message: `[${surface}] 고객 문구에 내부 배포일/잘린 마감일 문구가 노출됨`,
    });
  }

  return incidents;
}

export function buildMobileQaImprovementEvent(input: {
  packageId: string;
  expected: ExpectedRender;
  incidents: QAIncident[];
  createdAt?: string;
}): ImprovementLedgerEvent | null {
  if (input.incidents.length === 0) return null;

  const failures = input.incidents.map(incident => `${incident.id}: ${incident.message}`);
  const normalizedBlockerSignatures = [...new Set(
    failures.map(normalizeBlockerSignature).filter(Boolean),
  )];
  const hasBlockingIncident = input.incidents.some(incident =>
    incident.severity === 'critical' || incident.severity === 'high',
  );

  return {
    uploadId: `mobile-qa:${input.packageId}`,
    productId: input.expected.internalCode,
    packageId: input.packageId,
    attemptNo: 0,
    attemptPhase: 'render_payload_audit_repair',
    rawTextHash: hashSourceText(input.expected.rawText || input.packageId),
    sectionRawTextHash: null,
    parserVersion: 'auto-mobile-qa',
    detectedFormat: 'post_save_mobile_landing',
    blockersBefore: failures,
    blockersAfter: failures,
    normalizedBlockerSignatures,
    evidenceSpans: [],
    comparedFields: [
      'mobile_landing_html',
      'lp_html',
      'hero_image',
      'flight_card',
      'hotel_names',
      'optional_tours',
      'customer_visible_copy',
    ],
    autoFixesApplied: [],
    packagesAudit: {
      status: hasBlockingIncident ? 'fail' : 'warn',
      failures: input.incidents
        .filter(incident => incident.severity === 'critical' || incident.severity === 'high')
        .map(incident => `${incident.id}: ${incident.message}`),
      warnings: input.incidents
        .filter(incident => incident.severity === 'medium')
        .map(incident => `${incident.id}: ${incident.message}`),
    },
    a4Audit: { status: 'unknown', failures: [], warnings: [] },
    finalStatus: hasBlockingIncident ? 'BLOCKED' : 'REVIEW_NEEDED',
    fixtureCandidate: true,
    ruleCandidate: normalizedBlockerSignatures.length > 0,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

const SURFACE_FETCH_RETRY_DELAYS_MS = [0, 2_000, 5_000, 10_000] as const;

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function looksLikeTransientHiddenPackage(html: string | null): boolean {
  if (!html) return true;
  return /NOT_FOUND|패키지를 찾을 수 없습니다|Package not found|not found/i.test(html);
}

async function fetchSurfaceHtml(pageUrl: string): Promise<string | null> {
  const headers: Record<string, string> = { 'User-Agent': 'YeosonamAutoQA/1.0' };
  const proofSecret = getSecret('REVALIDATE_SECRET') || getSecret('ADMIN_API_TOKEN');
  if (proofSecret) headers['x-yeosonam-render-proof'] = proofSecret;
  headers['Cache-Control'] = 'no-cache';
  const res = await fetch(pageUrl, { headers, cache: 'no-store' });
  if (!res.ok) return null;
  return res.text();
}

async function fetchSurfaceHtmlWithRetry(pageUrl: string): Promise<string | null> {
  let lastHtml: string | null = null;
  for (const delayMs of SURFACE_FETCH_RETRY_DELAYS_MS) {
    if (delayMs > 0) await wait(delayMs);
    lastHtml = await fetchSurfaceHtml(pageUrl);
    if (!looksLikeTransientHiddenPackage(lastHtml)) return lastHtml;
  }
  return lastHtml;
}

export async function runAutoMobileQA(
  packageId: string,
  baseUrl?: string,
  options: { includeLpForProof?: boolean } = {},
): Promise<void> {
  if (!isSupabaseAdminConfigured) return;
  const url = baseUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeosonam.com';

  try {
    const expected = await loadExpectedRender(packageId);

    const revalidatePaths = buildRevalidatePaths(packageId, expected.shortCode);

    const secret = getSecret('REVALIDATE_SECRET');
    if (secret) {
      await fetch(`${url}/api/revalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: revalidatePaths, secret }),
      }).catch((e) =>
        console.warn(`[AutoQA] revalidate fetch failed for ${packageId}:`, e?.message ?? e),
      );
    }

    await wait(3_000);

    const surfaces: Array<{ surface: 'packages' | 'lp'; pageUrl: string }> = [
      { surface: 'packages', pageUrl: `${url}/packages/${packageId}` },
      ...(isCustomerVisibleStatus(expected.status) || options.includeLpForProof
        ? [{ surface: 'lp' as const, pageUrl: `${url}/lp/${packageId}` }]
        : []),
    ];

    const incidents: QAIncident[] = [];
    const surfaceProofResults: Array<{
      surface: 'packages' | 'lp';
      status: 'pass';
      page_url: string;
      screen_hash: string;
      customer_visible_hash: string;
    }> = [];
    for (const { surface, pageUrl } of surfaces) {
      const html = await fetchSurfaceHtmlWithRetry(pageUrl);
      if (!html) {
        console.warn(`[AutoQA] ${packageId}: ${surface} fetch fail`);
        incidents.push({
          id: `${surface === 'lp' ? 'lp_' : 'mobile_'}surface_fetch_failed`,
          severity: 'high',
          message: `[${surface}] customer mobile proof fetch failed`,
        });
        continue;
      }
      surfaceProofResults.push({
        surface,
        status: 'pass',
        page_url: pageUrl,
        screen_hash: hashSourceText(html),
        customer_visible_hash: hashSourceText(htmlToText(html)),
      });
      incidents.push(...analyzeMobileHtml(html, expected, surface));
    }

    // G5 박제 (2026-05-15): 관광지 매칭률 검증 + admin_alerts 자동 적재
    //   ai_quality_log 의 attraction_matched_count / attraction_unmatched_count 로 비율 계산
    //   < 60% 면 admin_alerts 적재 + critical 시 Slack. 사장님이 모바일 안 봐도 자동 알림.
    let matchedCount = expected.currentAttractionMatchedCount ?? 0;
    let unmatchedCount = expected.currentAttractionUnmatchedCount ?? 0;
    let matchRate = matchedCount + unmatchedCount > 0
      ? matchedCount / (matchedCount + unmatchedCount)
      : 1;
    try {
      if (matchedCount + unmatchedCount === 0) {
        const { data: ql } = await supabaseAdmin
          .from('ai_quality_log')
          .select('attraction_matched_count, attraction_unmatched_count')
          .eq('package_id', packageId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (ql) {
          matchedCount = ((ql as { attraction_matched_count?: number }).attraction_matched_count ?? 0);
          unmatchedCount = ((ql as { attraction_unmatched_count?: number }).attraction_unmatched_count ?? 0);
          matchRate = matchedCount + unmatchedCount > 0 ? matchedCount / (matchedCount + unmatchedCount) : 1;
        }
      }
      const ql = { attraction_matched_count: matchedCount, attraction_unmatched_count: unmatchedCount };
      {
        matchedCount = ((ql as { attraction_matched_count?: number }).attraction_matched_count ?? 0);
        unmatchedCount = ((ql as { attraction_unmatched_count?: number }).attraction_unmatched_count ?? 0);
        const denom = matchedCount + unmatchedCount;
        matchRate = denom > 0 ? matchedCount / denom : 1;
        if (denom >= 3 && matchRate < 0.6) {
          incidents.push({
            id: 'mobile_attraction_match_low',
            severity: 'high',
            message: `관광지 매칭률 ${(matchRate * 100).toFixed(0)}% (${matchedCount}/${denom}) — 60% 미달, attraction 시드 / aliases 점검 필요`,
          });
        }
      }
    } catch { /* swallow — ai_quality_log fetch fail 시 alert skip */ }

    // 4) ai_quality_log 적재. 이전 AutoQA 결과는 현재 HTML 기준으로 대체한다.
    const { data: latestLog } = await supabaseAdmin
      .from('ai_quality_log')
      .select('id, failed_checks')
      .eq('package_id', packageId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestLog?.id) {
      const existing = Array.isArray((latestLog as { failed_checks?: unknown[] }).failed_checks)
        ? ((latestLog as { failed_checks: unknown[] }).failed_checks)
        : [];
      const merged = [
        ...existing.filter(check => !isAutoQACheck(check)),
        ...incidents.map(i => ({ id: i.id, severity: i.severity, passed: false, message: i.message })),
      ];
      await supabaseAdmin
        .from('ai_quality_log')
        .update({ failed_checks: merged })
        .eq('id', latestLog.id);
    }

    if (incidents.length > 0) {
      console.warn(`[AutoQA] ${packageId}: ${incidents.length} mobile incident(s)`);
      const ledgerEvent = buildMobileQaImprovementEvent({ packageId, expected, incidents });
      if (ledgerEvent) {
        const persisted = await persistImprovementLedgerEvents({
          supabase: supabaseAdmin,
          isSupabaseConfigured,
          events: [ledgerEvent],
        });
        if (persisted.error) {
          console.warn('[AutoQA] improvement ledger save failed:', persisted.error);
        }
      }

      // G5: high/critical incident 시 admin_alerts 적재 (사장님 어드민 대시보드 빨간 배지)
      const hiSev = incidents.filter(i => i.severity === 'high' || i.severity === 'critical');
      if (hiSev.length === 0) {
        const checkedAt = new Date().toISOString();
        try {
          const { data: pkgRow } = await supabaseAdmin
            .from('travel_packages')
            .select('audit_report')
            .eq('id', packageId)
            .maybeSingle();
          const existingReport = (pkgRow as { audit_report?: Record<string, unknown> | null } | null)?.audit_report;
          await supabaseAdmin
            .from('travel_packages')
            .update({
              audit_checked_at: checkedAt,
              audit_report: {
                ...clearStaleMobileQaFailures(existingReport),
                source: 'auto_mobile_qa',
                incidents,
                checked_at: checkedAt,
                mobile_browser_proof: buildMobileBrowserProofPayload({
                  status: 'pass',
                  checkedAt,
                  packageUpdatedAt: expected.updatedAt,
                  surfaces,
                  surfaceProofResults,
                }),
                mobile_browser_proof_warnings: {
                  status: 'warn',
                  reason: 'auto mobile QA found customer render incidents below hard-block severity',
                  incidents,
                  checked_at: checkedAt,
                },
              },
            })
            .eq('id', packageId);
        } catch (e) {
          console.warn('[AutoQA] failed to persist mobile proof incidents:', e instanceof Error ? e.message : e);
        }
      }
      if (hiSev.length > 0) {
        const checkedAt = new Date().toISOString();
        try {
          const { data: pkgRow } = await supabaseAdmin
            .from('travel_packages')
            .select('audit_report')
            .eq('id', packageId)
            .maybeSingle();
          const existingReport = (pkgRow as { audit_report?: Record<string, unknown> | null } | null)?.audit_report;
          await supabaseAdmin
            .from('travel_packages')
            .update({
              status: 'pending_review',
              audit_status: 'blocked',
              audit_checked_at: checkedAt,
              audit_report: {
                ...clearStaleMobileQaFailures(existingReport),
                source: 'auto_mobile_qa',
                incidents: hiSev,
                checked_at: checkedAt,
                mobile_browser_proof: buildMobileBrowserProofPayload({
                  status: 'fail',
                  checkedAt,
                  packageUpdatedAt: expected.updatedAt,
                  surfaces,
                  surfaceProofResults,
                }),
                mobile_browser_proof_required: {
                  status: 'fail',
                  reason: 'auto mobile QA found high/critical customer render incidents',
                  checked_at: checkedAt,
                },
              },
              updated_at: checkedAt,
            })
            .eq('id', packageId);

          if (expected.internalCode) {
            await supabaseAdmin
              .from('products')
              .update({ status: 'pending_review', updated_at: checkedAt })
              .eq('internal_code', expected.internalCode);
          }
        } catch (e) {
          console.warn('[AutoQA] failed to block customer-visible package:', e instanceof Error ? e.message : e);
        }

        try {
          const { postAlert } = await import('@/lib/admin-alerts');
          const summary = hiSev.slice(0, 3).map(i => `[${i.severity}] ${i.message}`).join(' / ');
          await postAlert({
            category: 'general',
            severity: hiSev.some(i => i.severity === 'critical') ? 'critical' : 'warning',
            title: `모바일 QA 실패 (${hiSev.length}건)${matchRate < 0.6 && matchedCount + unmatchedCount >= 3 ? ` · 매칭률 ${(matchRate * 100).toFixed(0)}%` : ''}`,
            message: summary,
            ref_type: 'travel_package',
            ref_id: packageId,
            meta: { incidents: hiSev, matched: matchedCount, unmatched: unmatchedCount, matchRate },
            dedupe: true,
          });
        } catch (e) {
          console.warn('[AutoQA] admin_alerts 적재 실패(무시):', e instanceof Error ? e.message : e);
        }
      }
    } else {
      const checkedAt = new Date().toISOString();
      try {
        const { data: pkgRow } = await supabaseAdmin
          .from('travel_packages')
          .select('audit_report')
          .eq('id', packageId)
          .maybeSingle();
        const existingReport = (pkgRow as { audit_report?: Record<string, unknown> | null } | null)?.audit_report;
        await supabaseAdmin
          .from('travel_packages')
          .update({
            audit_report: {
              ...clearStaleMobileQaFailures(existingReport),
              mobile_browser_proof: buildMobileBrowserProofPayload({
                status: 'pass',
                checkedAt,
                packageUpdatedAt: expected.updatedAt,
                surfaces,
                surfaceProofResults,
              }),
            },
            audit_checked_at: checkedAt,
          })
          .eq('id', packageId);
      } catch (e) {
        console.warn('[AutoQA] mobile proof save failed:', e instanceof Error ? e.message : e);
      }
      console.log(`[AutoQA] ${packageId}: mobile clean ✓`);
    }
  } catch (e) {
    console.warn('[AutoQA] 실패(무시):', (e as Error).message);
  }
}
