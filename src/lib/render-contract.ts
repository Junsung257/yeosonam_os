/**
 * @file render-contract.ts — Canonical Render Contract (CRC) v1
 *
 * 목적 (W1):
 *   A4 포스터(`YeosonamA4Template`)와 모바일(`DetailClient`)이 동일 데이터를
 *   각자 정규식·폴백으로 해석하여 발생하는 불일치(ERR-KUL-05 계열 14건+)를
 *   **단일 진입점**으로 차단한다.
 *
 * 원칙:
 *   - 렌더러는 `renderPackage(pkg)` 출력(`CanonicalView`)만 소비한다.
 *   - 렌더러 내부에서 `pkg.excludes`·`pkg.surcharges`·`pkg.special_notes`·
 *     `pkg.airline` 등을 **직접 파싱/폴백 처리하지 않는다**.
 *   - 새 렌더링 로직은 이 모듈에 추가하고, 렌더러는 `view.*` 를 읽기만 한다.
 *
 * W1 범위(4 섹션):
 *   - airlineHeader — "BX793(에어부산) 부산 → 타이페이" 완성 라벨
 *   - optionalTours — region별 그룹핑 + 정규화 이름
 *   - surchargesMerged — 객체 배열 ∪ excludes 문자열 (bare surcharge 중복 제거)
 *   - excludes.basic — surcharge 분류 후 남은 일반 불포함 항목
 *   - shopping — highlights.shopping → special_notes 폴백 (내부 키워드 차단)
 *
 * 관련 에러:
 *   - ERR-20260418-03/10/14 (surcharges 누락·병합)
 *   - ERR-20260418-04/09 (optional_tours 필드 polymorphism)
 *   - ERR-20260418-13/17 (airline 라벨 장황함·괄호 중복)
 *   - ERR-FUK-customer-leaks (special_notes → shopping 내부 메모 누출)
 *   - ERR-KUL-04/05 (region 라벨 A4/Mobile 불일치)
 */

import {
  normalizeOptionalTour,
  groupOptionalToursByRegion,
  type OptionalTourInput,
  type NormalizedOptionalTour,
  type OptionalTourGroup,
} from './itinerary-render';
import {
  formatExcludeDisplayLabel,
  isMealDayExcludeLine,
  repairMealDayExcludeItems,
  shouldSplitAtComma,
} from '@/lib/parser/deterministic/comma-split-safe';
import {
  normalizeCatalogInclusions,
  normalizeCatalogExcludes,
  normalizeCatalogSurchargeLine,
  parseShoppingText,
  SHOPPING_POLICY_NOTE,
  formatTermLine,
  type NormalizedTermLine,
} from '@/lib/terms-catalog';
import type { CustomerSafeNotice } from '@/lib/product-registration-v3/customer-payload';
import { normalizeStructuredDayEntities } from '@/lib/itinerary-structured-entities';

// ═══════════════════════════════════════════════════════════════════════════
//  Input / Output 타입
// ═══════════════════════════════════════════════════════════════════════════

/** Surcharge 객체 — ERR-20260418-03 */
export interface SurchargeObject {
  name?: string;
  start?: string;        // "YYYY-MM-DD"
  end?: string;
  amount?: number;
  currency?: string;     // "USD" | "KRW" | ...
  unit?: string;         // "인/박" 등
}

/** Schedule item — schedule 배열 안의 단일 엔트리 (pkg 내 원본 타입과 호환) */
export interface ScheduleItem {
  type?: string | null;
  time?: string | null;
  activity?: string | null;
  transport?: string | null;
  note?: string | null;
  /** upload route의 enrichItineraryWithAttractionReferences가 박은 관광지 ID 목록 */
  attraction_ids?: string[];
  /** upload route의 enrichItineraryWithAttractionReferences가 박은 관광지명 */
  attraction_names?: string[];
  entity_kind?: string | null;
  attraction_query?: string | null;
  attraction_queries?: string[];
  landing_sentence?: string | null;
  a4_sentence?: string | null;
}

/** Meal — day.meals 와 호환 */
export interface MealInfo {
  breakfast?: boolean | null;
  lunch?: boolean | null;
  dinner?: boolean | null;
  breakfast_note?: string | null;
  lunch_note?: string | null;
  dinner_note?: string | null;
}

/** HotelInfo — day.hotel 원본 */
export interface HotelInfo {
  name?: string | null;
  /** JSON/DB 에서 숫자(5)로 들어오는 케이스 있음 — 렌더 전 문자열로 정규화 */
  grade?: string | number | null;
  note?: string | null;
}

/** Day — pkg.itinerary_data.days[i] 원본 */
export interface DayInput {
  day?: number | null;
  regions?: string[] | null;
  schedule?: ScheduleItem[] | null;
  meals?: MealInfo | null;
  hotel?: HotelInfo | null;
}

/** renderPackage 입력 — A4와 Mobile의 pkg 공통 부분집합 */
export interface RenderPackageInput {
  airline?: string | null;
  /** ferry/cruise 감지에 사용 (2026-05-14) */
  title?: string | null;
  /** 'cruise' | 'ferry' | 'package' | 'golf' 등 — ferry 분류 우선 신호 */
  product_type?: string | null;
  departure_airport?: string | null;
  destination?: string | null;
  price_dates?: { date: string; price: number; child_price?: number; confirmed: boolean }[] | null;
  excludes?: string[] | null;
  surcharges?: SurchargeObject[] | null;
  optional_tours?: OptionalTourInput[] | null;
  /** @deprecated 2026-04-27 — 고객 노출 fallback 경로에서 제거됨. customer_notes 또는 internal_notes 사용. */
  special_notes?: string | null;
  /** 고객 노출 OK 자유 텍스트. 운영성 키워드는 W21 검증에서 차단. */
  customer_notes?: string | null;
  /** 운영 전용 메모. 고객 노출 차단 (어드민 전용). */
  internal_notes?: string | null;
  notices_parsed?: Array<CustomerSafeNotice | { type?: string; title?: string; text?: string }> | null;
  inclusions?: string[] | null;
  itinerary_data?: {
    meta?: {
      flight_out?: string | null;
      flight_in?: string | null;
      airline?: string | null;
      departure_airport?: string | null;
    } | null;
    flight_segments?: Array<{
      leg: 'outbound' | 'inbound';
      flight_no: string | null;
      dep_airport: string | null;
      dep_time: string | null;
      arr_airport: string | null;
      arr_time: string | null;
      arr_day_offset: 0 | 1;
    }> | null;
    highlights?: {
      shopping?: string | null;
      excludes?: string[] | null;
      inclusions?: string[] | null;
    } | null;
    days?: DayInput[] | null;
  } | null;
}

export interface AirlineHeader {
  /** 라우트 포함 완성 라벨: "BX793(에어부산) 부산 → 타이페이". 일정 페이지 헤더용. */
  label: string | null;
  /** 항공사 부분만: "BX793(에어부산)" / "BX793" / "에어부산". Page 1 배지용. */
  airlineLabel: string | null;
  /** "BX793" */
  flightNumber: string | null;
  /** "에어부산" */
  airlineName: string | null;
  /** 출발 도시 */
  departureCity: string | null;
  /** 도착 도시 (destination의 첫 토큰) */
  arrivalCity: string | null;
}

export interface MergedSurcharge {
  /** 렌더용 완성 라벨 (레거시·비정형 fallback) */
  label: string;
  /** 카탈로그 정형 라벨 + remainder */
  display: NormalizedTermLine | null;
  structured: SurchargeObject | null;
  raw: string | null;
  name: string | null;
  period: string | null;
  priceLabel: string | null;
}

export interface CanonicalExcludes {
  /** 렌더용 정형 라인 (카탈로그 + remainder) */
  display: NormalizedTermLine[];
  /** 하위 호환 — display를 한 줄 문자열로 펼친 배열 */
  basic: string[];
  /** excludes 중 써차지로 판정되었으나 surcharges 객체와 중복이 아닌 라인 */
  remainingSurchargeLines: string[];
}

export interface CanonicalShopping {
  /** 원문 (감사용) */
  text: string | null;
  /** 쇼핑 섹션 본문 — "2회 — 잡화, 토속품 등" */
  displayLine: string | null;
  count: number | null;
  items: string[];
  /** 카탈로그 형식 밖 나머지 → termsMisc */
  remainder: string | null;
  /** 원문에서 분리된 환불 정책 → termsMisc (쇼핑 섹션에 노출 X) */
  policyNote: string | null;
  source: 'highlights' | 'customer_notes' | null;
  blocked: boolean;
}

/** 포함/쇼핑과 분리된 하단 기타 안내 (부정적·법적 문구) */
export interface CanonicalTermsMisc {
  items: string[];
}

export interface CanonicalOptionalTours {
  groups: OptionalTourGroup[];
  flat: NormalizedOptionalTour[];
  count: number;
}

/** 아이콘이 매칭된 인클루전 토큰 */
export interface IconizedInclusion {
  text: string;
  icon: string;
  remainder?: string | null;
}

export interface CanonicalInclusions {
  /** 기본 포함 (항공·호텔·식사·보험 등) — 아이콘 매칭 완료 */
  basic: IconizedInclusion[];
  /** 프로그램/특전 — 아이콘 없이 텍스트만 */
  program: string[];
  /** 전체 평탄화된 원문 (감사·비교용) */
  flat: string[];
}

/** 단일 항공편 구간 — 레거시 2-flight 분리 데이터도 병합된 단일 구조체 */
export interface CanonicalFlight {
  code: string | null;           // "BX3615"
  airlineName: string | null;    // "에어부산"
  airlineLabel: string | null;   // "BX3615(에어부산)"
  depCity: string | null;
  arrCity: string | null;
  depTime: string | null;        // "10:30"
  arrTime: string | null;        // "11:50"
  /** 렌더 라벨: "부산 김해 출발 → 황산 툰시 도착 11:50" */
  label: string;
  /** MRT 실시간 스케줄 (getFlightSchedule 결과 주입 시 채워짐 — 우선 표시) */
  realtimeDepTime?: string;
  realtimeArrTime?: string;
  realtimeDate?:    string;
  /** 익일 도착이면 1 (예: 23:55 출발 → 다음날 06:40 도착). normalize-flight-segments 가 박제. */
  arrDayOffset?:    0 | 1;
}

/** 호텔 카드 — 하드코딩 헤더 제거용 구조화 출력 */
export interface CanonicalHotelCard {
  title: string;           // 동적 헤더: activity text 기반 ("호텔 체크인 및 휴식" / "호텔 투숙 및 휴식" / ...)
  name: string | null;     // 호텔명
  grade: string | null;    // 등급 "준5성"
  note: string | null;     // 호텔 note + activity에서 추출한 추가 메모(* 로 시작)
  /** activity에서 호텔 블록으로 흡수된 원문 (감사/복구용) */
  absorbedActivities: string[];
  /** MRT 리뷰 데이터 — attractions 테이블 mrt_rating/mrt_review_count 기반 (선택) */
  mrtRating?:       number;
  mrtReviewCount?:  number;
}

/** 정규화된 단일 일차 */
export interface CanonicalDay {
  day: number;
  regions: string[];
  /** flight 블록을 단일로 병합하고, 호텔 activity는 분리한 후 남은 schedule */
  schedule: ScheduleItem[];
  /** 이 날의 대표 flight (있으면) — 히어로/타임라인 공용 */
  flight: CanonicalFlight | null;
  /** 호텔 블록 — 하드코딩 헤더 대신 이 카드를 렌더 */
  hotelCard: CanonicalHotelCard | null;
  meals: MealInfo | null;
}

/**
 * 헤더용 flight 한 쌍 (출발편 / 귀국편).
 * outbound = 첫 날 항공편 (한국 → 도착지)
 * inbound  = 마지막 날 항공편 (도착지 → 한국). 마지막 날에 없으면 마지막-1일에서 fallback.
 *
 * 렌더 위치: A4 포스터 상단 항공 카드 + 모바일 일정 카드 헤더.
 * 사용자 코드는 view.flightHeader 만 소비하고, view.days[i].schedule 재파싱 금지.
 */
export interface FlightHeader {
  outbound: CanonicalFlight | null;
  inbound: CanonicalFlight | null;
}

/** Cruise/Ferry 전용 — 선박 스케줄 (UX-4, 2026-05-14 박제) */
export interface CruiseSchedule {
  /** 출항: "부산 → 시모노세키 21:00→08:00" */
  outboundLabel: string | null;
  /** 회항: "시모노세키 → 부산 19:45→08:00" */
  inboundLabel: string | null;
  /** 선박명 (예: "부관훼리") */
  vesselName: string | null;
  /** 선실 등급 메모 */
  cabinNote: string | null;
}

export interface CanonicalView {
  airlineHeader: AirlineHeader;
  /** 출발/귀국 항공편 헤더 (Phase 2 확장 — ERR-KUL-05 후속) */
  flightHeader: FlightHeader;
  /** Cruise/Ferry 전용 선박 스케줄 — isFerryPackage 일 때만 채워짐 */
  cruiseSchedule: CruiseSchedule | null;
  optionalTours: CanonicalOptionalTours;
  /** optionalTours.groups 단축 — 렌더러 직접 소비용 (CRC v1 마이그레이션 보조) */
  optionalToursByRegion: OptionalTourGroup[];
  surchargesMerged: MergedSurcharge[];
  excludes: CanonicalExcludes;
  shopping: CanonicalShopping;
  /** 쇼핑 환불 등 — 메인 약관 섹션과 분리된 하단 안내 */
  termsMisc: CanonicalTermsMisc;
  /** 인클루전 아이콘 매칭 + 기본/프로그램 분류 — A4·Mobile 공용 (Phase 1 확장) */
  inclusions: CanonicalInclusions;
  /** 일차별 정규화 — flight 병합·호텔 카드 분리 (Phase 1 확장) */
  days: CanonicalDay[];
  /** Co-branding 메타: 어필리에이터가 발행한 콘텐츠일 때만 채워짐.
   *   null = 일반 여소남 콘텐츠 (단독 브랜드).
   *   객체 = 어필리에이터 + 여소남 동시 노출 + 광고 표시 자동 삽입.
   *   렌더러는 이 슬롯을 소비해서 카드뉴스 마지막 슬라이드 / 블로그 footer / A4 하단에
   *   "발행: {affiliate.name} × 여소남" + ad_disclosure 를 출력한다. */
  affiliateView: AffiliateCoBrand | null;
}

/** 어필리에이터 + 여소남 Co-branding 메타. content_distributions.payload._cobrand 와 동일. */
export interface AffiliateCoBrand {
  affiliate_id: string;
  affiliate_name: string;
  affiliate_handle: string;       // referral_code (= 짧은 도메인 핸들)
  affiliate_logo_url: string | null;
  affiliate_channel_url: string | null;
  brand_name: string;             // '여소남'
  brand_url: string;
  share_url: string;              // /packages/{id}?ref={code}
  ad_disclosure: string;          // 공정위 표시지침 워터마크
  generated_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  항공사 라벨 (ERR-20260418-13/17)
// ═══════════════════════════════════════════════════════════════════════════

/** IATA 2자리/1숫자2문자 코드 → 항공사 한글명 (A4·Mobile 통합본) */
const AIRLINE_MAP: Record<string, string> = {
  BX: '에어부산', LJ: '진에어', OZ: '아시아나항공', KE: '대한항공',
  '7C': '제주항공', TW: '티웨이항공', VJ: '비엣젯항공', ZE: '이스타항공',
  RS: '에어서울', QV: '라오항공', JL: '일본항공', NH: '전일본공수',
  MU: '중국동방항공', CA: '중국국제항공', CZ: '중국남방항공',
  D7: '에어아시아', OD: '바틱에어', '5J': '세부퍼시픽', VN: '베트남항공',
  SC: '산동항공',
  // 페리 (선박) — 카멜리아·부관훼리 등
  // ERR-PackageCard-ferry-airline@2026-04-29: 카멜리아 패키지 카드에 "선박" 만 노출되던 버그 방어.
  // getAirlineName("카멜리아 (선박)") → 이전: "선박" (parenMatch fallback) / 이후: "카멜리아"
  '카멜리아': '카멜리아', '부관훼리': '부관훼리', '뉴카멜리아': '뉴카멜리아',
};

/**
 * 항공 코드/원문에서 항공사 한글명 추출.
 * ERR-20260418-17 — "BX(에어부산)" / "BX793" / "BX | 부산..." 모두 안전하게 처리.
 *
 * digit-prefix IATA 코드(7C 제주, 5J 세부퍼시픽) 보존:
 *   trailing 숫자(편명)만 strip 하고 prefix 숫자는 유지.
 */
export function getAirlineName(flightCode?: string | null): string | null {
  if (!flightCode) return null;
  const code = flightCode.split(/[\s|(]/)[0].replace(/\d+$/, '').toUpperCase().trim();
  if (AIRLINE_MAP[code]) return AIRLINE_MAP[code];
  const parenMatch = flightCode.match(/\(([^)]+)\)/);
  if (parenMatch && /[가-힣]/.test(parenMatch[1])) return parenMatch[1].trim();
  return null;
}

function airportToDepCity(ap?: string | null): string | null {
  if (!ap) return null;
  if (ap.includes('김해') || ap.includes('부산')) return '부산';
  if (ap.includes('인천') || ap.includes('서울')) return '서울/인천';
  if (ap.includes('대구')) return '대구';
  if (ap.includes('제주')) return '제주';
  if (ap.includes('청주')) return '청주';
  const stripped = ap.replace(/국제공항|공항/g, '').trim();
  return stripped || null;
}

/** Ferry/Cruise 감지 — airline/title 에 페리 키워드가 있으면 항공편 헤더를 전면 차단 (2026-05-14 박제).
 *  부관훼리 케이스에서 "후쿠오카 출발 → 부산(김해) 도착" 항공편 헤더가 ferry 인데도 매 day 박히던 사고 방지. */
const FERRY_KEYWORDS = /부관훼리|뉴카멜리아|카멜리아|훼리|페리|선박|크루즈|cruise|ferry/i;
export function isFerryPackage(pkg: RenderPackageInput): boolean {
  const productType = pkg.product_type ?? '';
  if (productType === 'cruise' || productType === 'ferry') return true;
  const airlineRaw = pkg.airline ?? '';
  const meta = pkg.itinerary_data?.meta ?? null;
  const airlineMeta = meta?.airline ?? '';
  const title = pkg.title ?? '';
  return FERRY_KEYWORDS.test(`${airlineRaw} ${airlineMeta} ${title}`);
}

export function resolveAirlineHeader(pkg: RenderPackageInput): AirlineHeader {
  // Ferry/Cruise 는 항공편 헤더 자체를 노출하지 않음 (환각 차단)
  if (isFerryPackage(pkg)) {
    return { label: null, airlineLabel: null, flightNumber: null, airlineName: null, departureCity: null, arrivalCity: null };
  }
  const meta = pkg.itinerary_data?.meta ?? null;
  const flightNumber = meta?.flight_out?.trim() || null;
  const airlineRaw = pkg.airline || meta?.airline || null;
  const airlineName = getAirlineName(flightNumber || airlineRaw);
  const departureCity = airportToDepCity(pkg.departure_airport || meta?.departure_airport);
  const arrivalCity = pkg.destination?.split(/[\/,]/)[0]?.trim() || null;

  // airlineLabel (배지용): flight + airline 조합을 상황별로 포맷
  let airlineLabel: string | null = null;
  if (flightNumber && airlineName) airlineLabel = `${flightNumber}(${airlineName})`;
  else if (flightNumber) airlineLabel = flightNumber;
  else if (airlineName) airlineLabel = airlineName;

  // label (일정 페이지 헤더용): airlineLabel + route
  let label: string | null = null;
  if (airlineLabel || (departureCity && arrivalCity)) {
    const route = departureCity && arrivalCity
      ? `${departureCity} → ${arrivalCity}`
      : (arrivalCity || departureCity || '');
    label = [airlineLabel, route].filter(Boolean).join(' ').trim() || null;
  }

  return { label, airlineLabel, flightNumber, airlineName, departureCity, arrivalCity };
}

// ═══════════════════════════════════════════════════════════════════════════
//  써차지 병합 (ERR-20260418-03/10/14)
// ═══════════════════════════════════════════════════════════════════════════

/** 추가요금 키워드 — excludes 문자열 중 surcharge로 분류할 패턴.
 *
 * NOTE (ERR-HET-single-charge-misclass@2026-04-22):
 *   "싱글차지" 는 **기간 기반 써차지가 아니라 룸타입 기반 요금**이라 제외.
 *   원문 "불포함"에 들어있던 싱글차지가 "💲 기간별 추가 요금"으로 자동 이동하고
 *   모바일의 "※ 위 기간 출발 시 1박당 해당 금액이 추가됩니다" 하드코딩 문구에
 *   얹혀서 "1박당"으로 오인되는 오류가 발생 → 싱글차지는 basic(불포함)에 유지.
 */
export const SURCHARGE_RE = /\d+만원|\$\d+|써차지|추가요금|룸당|박당|의무디너|필수식사/;

/** "써차지 ($10/인/박)" 같이 구체 정보 없는 단순 안내 문구인지 */
function isBareSurcharge(s: string): boolean {
  return /^\s*(?:하계\s*)?써차지\s*(?:\(?\s*\$?\s*\d*\s*\/?\s*(?:인|박|인\/박)?\s*\)?)?\s*$/i.test(s.trim());
}

/**
 * 배열 항목 평탄화: 콤마로 이어붙인 단일 문자열도 개별 항목으로 분리.
 * ERR-20260418-26 — 괄호 내부 콤마는 분리하지 말 것.
 * ERR-FUK-comma-number — "2,000엔" 같은 숫자 천단위 콤마 분리 방지.
 * ERR-BOH-meal-days — "3일차 중식, 석식" 은 한 줄 유지 + 가독 포맷.
 */
export function flattenItems(items: string[]): string[] {
  const repaired = repairMealDayExcludeItems(items);
  const result: string[] = [];
  for (const item of repaired) {
    if (SURCHARGE_RE.test(item)) {
      result.push(item.trim());
      continue;
    }
    if (isMealDayExcludeLine(item)) {
      result.push(formatExcludeDisplayLabel(item));
      continue;
    }
    const parts: string[] = [];
    let depth = 0;
    let buf = '';
    const chars = [...item];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
      if ((ch === ',' || ch === '，') && depth === 0) {
        if (!shouldSplitAtComma(item, i, depth)) {
          buf += ch;
          continue;
        }
        const t = buf.trim();
        if (t) parts.push(t);
        buf = '';
      } else {
        buf += ch;
      }
    }
    const t = buf.trim();
    if (t) parts.push(t);
    result.push(...parts);
  }
  return result;
}

/** excludes 배열을 basic / surcharge 로 분류 */
export function classifyExcludes(items: string[]): { basic: string[]; surcharges: string[] } {
  const flat = flattenItems(items);
  const basic: string[] = [];
  const surcharges: string[] = [];
  for (const item of flat) {
    // 쇼핑 불참 패널티 — 유의사항(CRITICAL) 전용, 불포함·추가요금 UI 아님
    if (/패널티|쇼핑\s*샵|쇼핑샵|쇼핑.*불참|참여\s*하지\s*않/.test(item)) continue;
    if (SURCHARGE_RE.test(item)) surcharges.push(item);
    else basic.push(item);
  }
  return { basic, surcharges };
}

/** Surcharge 객체 → 렌더용 `MergedSurcharge` */
function formatSurchargeObject(s: SurchargeObject): MergedSurcharge {
  const name = s.name?.trim() || '추가요금';
  const periodRaw = s.start && s.end ? `${s.start} ~ ${s.end}` : (s.start || '');
  const period = periodRaw
    ? periodRaw
        .replace(/^\d{4}-0?(\d+)-0?(\d+)\s*~\s*\d{4}-0?(\d+)-0?(\d+)$/, '$1/$2 ~ $3/$4')
        .replace(/^\d{4}-0?(\d+)-0?(\d+)$/, '$1/$2')
    : null;
  // P0 #3 (2026-04-27): 통화별 한국어 친화 표기. KRW 는 천단위 콤마 + "원" suffix.
  // 외화는 코드 prefix 유지 (USD→$, JPY→¥, CNY→元).
  const fmtAmount = (() => {
    if (s.amount == null) return null;
    const cur = (s.currency || 'KRW').toUpperCase();
    const num = Number(s.amount);
    if (cur === 'KRW') return `${num.toLocaleString('ko-KR')}원`;
    if (cur === 'USD') return `$${num.toLocaleString('en-US')}`;
    if (cur === 'JPY') return `¥${num.toLocaleString('ja-JP')}`;
    if (cur === 'CNY') return `${num.toLocaleString('zh-CN')}元`;
    return `${cur} ${num.toLocaleString('ko-KR')}`;
  })();
  const priceLabel = fmtAmount ? `${fmtAmount}${s.unit ? `/${s.unit}` : ''}` : null;
  const label = `${name}${period ? ` (${period})` : ''}${priceLabel ? `: ${priceLabel}` : ''}`;
  const syntheticRaw = `${name}${priceLabel ? ` ${priceLabel}` : ''}`;
  const display = normalizeCatalogSurchargeLine(syntheticRaw);
  if (!display.slug) {
    display.text = label;
  }
  return { label, display, structured: s, raw: null, name, period, priceLabel };
}

export function resolveSurchargesAndExcludes(pkg: RenderPackageInput): {
  merged: MergedSurcharge[];
  excludes: CanonicalExcludes;
} {
  const objects = pkg.surcharges ?? [];
  const excludes = pkg.excludes ?? [];

  const classified = excludes.length > 0
    ? classifyExcludes(excludes)
    : { basic: [], surcharges: [] };

  const fromObjects = objects.map(formatSurchargeObject);
  const hasObjects = fromObjects.length > 0;

  // ERR-20260418-14/18 — 구조화 객체가 있으면 excludes의 단순 "써차지" 문구는 중복
  const remainingSurchargeLines = classified.surcharges.filter(
    s => !(hasObjects && isBareSurcharge(s)),
  );
  const fromExcludesMerged: MergedSurcharge[] = remainingSurchargeLines.map(raw => {
    const normalized = normalizeCatalogSurchargeLine(raw);
    return {
      label: formatTermLine(normalized),
      display: normalized,
      structured: null,
      raw,
      name: null,
      period: null,
      priceLabel: null,
    };
  });

  const excludeDisplay = normalizeCatalogExcludes(classified.basic);

  return {
    merged: [...fromObjects, ...fromExcludesMerged],
    excludes: {
      display: excludeDisplay,
      basic: excludeDisplay.map(formatTermLine),
      remainingSurchargeLines,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  쇼핑 출처 결정 (FIELD_POLICY.md, ERR-FUK-customer-leaks, ERR-special-notes-leak@2026-04-27)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 고객 노출 텍스트에 절대 들어가면 안 되는 내부 메모 키워드.
 * customer_notes 검증의 마지막 안전망 — Pre-INSERT(W21)에서 1차 차단되지만
 * 회색지대 통과를 대비한 렌더 시점 2중 가드.
 */
const INTERNAL_KEYWORDS = /커미션|commission_rate|정산|LAND_OPERATOR|스키마\s*제약|랜드사\s*메모|랜드사\s*커미션/i;
const SHOPPING_HINT_RE = /쇼핑|면세|노쇼핑|마트|센터\s*\d+회|방문\s*\d+회/i;

/**
 * 쇼핑 섹션 출처 우선순위:
 *   1) itinerary_data.highlights.shopping (가장 명시적)
 *   2) customer_notes (고객 노출 OK 검증 통과 자유 텍스트)
 *   3) special_notes는 더 이상 fallback 출처가 아님 (ERR-special-notes-leak 차단)
 */
function buildCanonicalShopping(
  raw: string,
  source: CanonicalShopping['source'],
): CanonicalShopping {
  const text = raw.replace(/^쇼핑\s*[:：]\s*/i, '').trim() || null;
  if (!text) {
    return {
      text: null,
      displayLine: null,
      count: null,
      items: [],
      remainder: null,
      policyNote: null,
      source,
      blocked: false,
    };
  }
  const parsed = parseShoppingText(text);
  return {
    text,
    displayLine: parsed.displayLine,
    count: parsed.count,
    items: parsed.items,
    remainder: parsed.remainder,
    policyNote: parsed.policyNote,
    source,
    blocked: false,
  };
}

export function resolveShopping(pkg: RenderPackageInput): CanonicalShopping {
  const fromHighlights = pkg.itinerary_data?.highlights?.shopping?.trim();
  if (fromHighlights) {
    return buildCanonicalShopping(fromHighlights, 'highlights');
  }
  const fallback = pkg.customer_notes?.trim();
  if (!fallback) {
    return {
      text: null,
      displayLine: null,
      count: null,
      items: [],
      remainder: null,
      policyNote: null,
      source: null,
      blocked: false,
    };
  }
  // customer_notes fallback은 쇼핑 단서가 있을 때만 허용
  // (표준 notice/customer 문구가 쇼핑 섹션으로 오인 노출되는 누출 방지)
  if (!SHOPPING_HINT_RE.test(fallback)) {
    return {
      text: null,
      displayLine: null,
      count: null,
      items: [],
      remainder: null,
      policyNote: null,
      source: null,
      blocked: false,
    };
  }

  // 내부 키워드 감지 시 차단 — 렌더 시점 2중 가드
  if (INTERNAL_KEYWORDS.test(fallback)) {
    return {
      text: null,
      displayLine: null,
      count: null,
      items: [],
      remainder: null,
      policyNote: null,
      source: 'customer_notes',
      blocked: true,
    };
  }
  return buildCanonicalShopping(fallback, 'customer_notes');
}

export function resolveTermsMisc(shopping: CanonicalShopping): CanonicalTermsMisc {
  const items: string[] = [];
  const line = shopping.displayLine ?? shopping.text;
  const isNoShopping = line ? /노쇼핑/.test(line) : false;

  if (shopping.count != null && shopping.count > 0 && !isNoShopping) {
    items.push(SHOPPING_POLICY_NOTE);
  }

  if (shopping.remainder?.trim()) {
    const r = shopping.remainder.trim();
    if (!/교환|환불|수수료\s*발생|한\s*달|한달/.test(r)) {
      items.push(r);
    }
  }

  return { items };
}

// ═══════════════════════════════════════════════════════════════════════════
//  선택관광 정규화
// ═══════════════════════════════════════════════════════════════════════════

export function resolveOptionalTours(pkg: RenderPackageInput): CanonicalOptionalTours {
  const tours = pkg.optional_tours ?? [];
  const flat = tours.map(normalizeOptionalTour);
  const groups = groupOptionalToursByRegion(tours);
  return { groups, flat, count: flat.length };
}

// ═══════════════════════════════════════════════════════════════════════════
//  인클루전 아이콘 매칭 (Phase 1 이관 — A4 템플릿 BASIC_INC_RE / getInclusionIcon)
//  ERR-HSN-render-bundle 오류 1 (A4 "✅ 택스, 한국어..." 5개 묶음) 근본 해결.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 기본 포함 키워드 — "프로그램" 이 아닌 "표준 항목" 분류에 사용.
 * "택스" (ERR-HSN-render-bundle 반영, 기존 BASIC_INC_RE 의 "텍스" 오타 보정)
 * 2026-05-14: ferry/cruise 키워드 추가 (왕복훼리비/부두세/출국세/선내식 등) — 부관훼리 케이스에서
 * "왕복훼리비" 같은 명백한 포함사항이 program(특전 후보)으로 잘못 분류되던 사고 차단.
 */
const BASIC_INC_RE = /항공|TAX|택스|텍스|유류세?|호텔|숙박|리조트|식사|조식|중식|석식|차량|버스|리무진|가이드|인솔|보험|입장료|입장권|생수|노팁|노옵션|경비|고속열차|비자|VISA|그린피|라운드|골프|훼리비|페리비|부두세|출국세|공항세|공항이용료|선내식|선상식|관광지\s*입장/i;

/**
 * 진짜 특전 화이트리스트 — 일반 패키지에 없는 "보너스" 만.
 * fallback 분류 시 program → perk 승격 기준.
 */
const PERK_WHITELIST_RE = /마사지\s*\d+분|스파|쿠킹\s*클래스|와인\s*시음|VIP|업그레이드|선물|망고도시락|콩카페|위즐\s*커피|커피핀|특식|미슐랭|사진\s*촬영|케이블카|스피드보트|비경\s*투어|관람차|온천|디너\s*쇼|야경\s*투어|꽃잎\s*세레모니|허니문\s*특전/i;

/** "포함 사항" 가까운 (일반 적인) 항목은 특전 X — 블랙리스트 (UX-1 강화) */
const NOT_PERK_RE = /훼리비|페리비|항공|TAX|택스|유류|부두세|출국세|공항세|관광지\s*입장|차량|버스|가이드|보험|기본|호텔/i;

/** 진짜 특전 인지 판별 — render-contract.ts 외부에서 호출 가능 */
export function isRealPerk(text: string): boolean {
  if (!text) return false;
  if (NOT_PERK_RE.test(text)) return false;
  return PERK_WHITELIST_RE.test(text);
}

/** 아이콘 매칭 규칙 — 키워드 기반 */
export function getInclusionIcon(text: string): string {
  if (/항공|TAX|택스|텍스|유류/.test(text)) return '✈️';
  if (/호텔|숙박|리조트|게르/.test(text)) return '🏨';
  if (/식사|조식|중식|석식/.test(text)) return '🍽️';
  if (/차량|버스|생수|리무진/.test(text)) return '🚌';
  if (/가이드|인솔자|상주직원/.test(text)) return '👤';
  if (/보험/.test(text)) return '🛡️';
  if (/그린피|라운드|골프/.test(text)) return '⛳';
  if (/팁|노팁|노옵션|경비/.test(text)) return '💰';
  if (/입장료|입장권/.test(text)) return '🎫';
  if (/비자|VISA/i.test(text)) return '🛂';
  if (/고속열차|KTX|열차/.test(text)) return '🚄';
  if (/샌딩|송영|픽업/.test(text)) return '🚐';
  if (/써차지|서차지|연휴/.test(text)) return '📅';
  return '✅';
}

/** inclusions 자동 분류: 기본 포함 vs 프로그램/특전 (아이콘 매칭 포함)
 *  2026-05-14 UX-1 강화:
 *    - BASIC_INC_RE 매치 → basic (확장된 패턴: 훼리비/부두세/출국세 등 ferry 키워드)
 *    - PERK_WHITELIST_RE 매치 (BASIC 아니면) → program (진짜 특전만)
 *    - 둘 다 안 매치 → basic 으로 안전 fallback (포함사항으로 표시되지 특전으로 잘못 분류 X)
 */
export function classifyInclusions(items: string[]): CanonicalInclusions {
  const flat = flattenItems(items);
  const basicRaw: string[] = [];
  const program: string[] = [];
  for (const item of flat) {
    if (BASIC_INC_RE.test(item)) {
      basicRaw.push(item);
    } else if (PERK_WHITELIST_RE.test(item) && !NOT_PERK_RE.test(item)) {
      // 진짜 특전 (보너스성 키워드 매치)
      program.push(item);
    } else {
      // 분류 모호 → basic 으로 안전 fallback (특전 섹션 환각 차단)
      basicRaw.push(item);
    }
  }

  const catalogLines = normalizeCatalogInclusions(basicRaw);
  const basic: IconizedInclusion[] = catalogLines.map(line => ({
    text: line.text,
    icon: line.icon ?? getInclusionIcon(line.text),
    remainder: line.remainder,
  }));

  return { basic, program, flat };
}

function resolveInclusions(pkg: RenderPackageInput): CanonicalInclusions {
  const src = pkg.inclusions?.length
    ? pkg.inclusions
    : pkg.itinerary_data?.highlights?.inclusions ?? [];
  return classifyInclusions(src);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Day / Flight / Hotel 정규화 (Phase 1 이관 — DetailClient 718·728·851 근본 해결)
//  - 하루 flight activity 2개(출발·도착 분리) → 단일 CanonicalFlight 로 병합
//  - "호텔 투숙/휴식/체크인" activity 는 hotelCard 로 분리, 추가 메모(*로 시작) 흡수
//  - 원문 activity 텍스트는 훼손하지 않음 (Zero-Hallucination)
// ═══════════════════════════════════════════════════════════════════════════

/** 호텔 관련 activity 로 간주 (hotelCard 흡수 대상) */
const HOTEL_ACTIVITY_RE = /호텔.*(?:투숙|휴식|체크인|체크 인|체크아웃|체크 아웃)|투숙.*휴식|^\s*호텔\s*$/;

/** 공항/비행 관련 "도착" 아이템 — flight 카드에 합쳐지는 대상 */
const ARRIVAL_MARKER_RE = /국제공항\s*도착|공항\s*도착|도착\s*\/?\s*가이드\s*미팅/;

/** 레거시 병합: 연속 2 flight activity(출발 + 도착) → 단일 "A 출발 → B 도착 HH:MM" */
function extractSplitFlightCity(activity: string | null | undefined, kind: 'dep' | 'arr'): string | null {
  if (!activity) return null;
  const marker = kind === 'dep' ? '출발' : '도착';
  const cleaned = activity
    .replace(/^[A-Z0-9]{2,5}\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const match = cleaned.match(new RegExp(`^(.+?)(?:국제)?공항?\\s*${marker}`))
    || cleaned.match(new RegExp(`^(.+?)\\s*${marker}`));
  const city = match?.[1]?.trim();
  if (!city || /출발지|도착지/.test(city)) return null;
  return city;
}

function mergeLegacyFlightPair(schedule: ScheduleItem[]): {
  merged: ScheduleItem[];
  flight: CanonicalFlight | null;
} {
  if (!Array.isArray(schedule) || schedule.length === 0) {
    return { merged: [], flight: null };
  }

  let primaryFlight: CanonicalFlight | null = null;
  const out: ScheduleItem[] = [];

  for (let i = 0; i < schedule.length; i++) {
    const cur = schedule[i];
    const nxt = schedule[i + 1];

    // 연속 flight 쌍 감지: 첫 번째는 "출발", 두 번째는 "도착"
    const isPair =
      cur?.type === 'flight' &&
      nxt?.type === 'flight' &&
      /출발/.test(cur.activity || '') &&
      /도착/.test(nxt.activity || '') &&
      !/→|↦|⇒/.test(cur.activity || ''); // 이미 병합된 경우는 그대로 유지

    if (isPair) {
      const depCity = extractSplitFlightCity(cur.activity, 'dep');
      const arrCity = extractSplitFlightCity(nxt.activity, 'arr');
      const code = cur.transport || nxt.transport || null;
      const label = `${depCity || '출발지'} 출발 → ${arrCity || '도착지'} 도착 ${nxt.time || ''}`.trim();
      const merged: ScheduleItem = {
        time: cur.time || null,
        activity: label,
        type: 'flight',
        transport: code,
        note: null,
      };
      out.push(merged);
      if (!primaryFlight) {
        primaryFlight = {
          code,
          airlineName: getAirlineName(code),
          airlineLabel: code ? (getAirlineName(code) ? `${code}(${getAirlineName(code)})` : code) : null,
          depCity,
          arrCity,
          depTime: cur.time || null,
          arrTime: nxt.time || null,
          label,
        };
      }
      i++; // 두 번째 flight 소비
      continue;
    }

    out.push(cur);

    // 단일 flight (이미 → 토큰으로 병합된 케이스) — primaryFlight 추출
    if (cur?.type === 'flight' && !primaryFlight) {
      const parsed = parseFlightActivity(cur.activity);
      const code = cur.transport || null;
      primaryFlight = {
        code,
        airlineName: getAirlineName(code),
        airlineLabel: code ? (getAirlineName(code) ? `${code}(${getAirlineName(code)})` : code) : null,
        depCity: parsed.depCity,
        arrCity: parsed.arrCity,
        depTime: cur.time || null,
        arrTime: parsed.arrTime || null,
        label: cur.activity || '',
      };
    }
  }

  return { merged: out, flight: primaryFlight };
}

/** 호텔 activity 분리 → hotelCard 로 흡수. 나머지는 schedule 에 남김. */
function extractHotelCard(schedule: ScheduleItem[], hotel: HotelInfo | null | undefined, isLastDay: boolean): {
  schedule: ScheduleItem[];
  hotelCard: CanonicalHotelCard | null;
} {
  if (isLastDay || !hotel?.name) {
    // 귀국일은 호텔 카드 없음. schedule 은 호텔 activity 도 텍스트 유지 (정보 손실 방지)
    return { schedule, hotelCard: null };
  }

  const absorbed: string[] = [];
  const extras: string[] = [];
  const out: ScheduleItem[] = [];
  let hotelTitle: string | null = null;

  for (const item of schedule) {
    const act = item?.activity || '';
    if (item?.type === 'normal' && HOTEL_ACTIVITY_RE.test(act)) {
      absorbed.push(act);
      // title 추출: "호텔 체크인 및 휴식" / "호텔 투숙 및 휴식" 그대로 동적 헤더로
      if (!hotelTitle) {
        const cleaned = act.replace(/^\*+\s*/, '').trim();
        hotelTitle = cleaned;
      }
      // "*과일 도시락" 같이 별표로 시작하는 추가 메모 extras 에 수집
      const starMatch = act.match(/\*([^*]+)$/);
      if (starMatch) extras.push(starMatch[1].trim());
      continue;
    }
    out.push(item);
  }

  // title 기본값: activity 없으면 "호텔 투숙 및 휴식" (정보 손실 대비 동적 fallback)
  const title = hotelTitle || '호텔 투숙 및 휴식';
  const note = [hotel.note, ...extras].filter(Boolean).join(' · ') || null;

  const rawGrade = hotel.grade;
  const gradeStr =
    rawGrade != null && rawGrade !== ''
      ? String(rawGrade).trim()
      : null;

  return {
    schedule: out,
    hotelCard: {
      title,
      name: hotel.name || null,
      grade: gradeStr,
      note,
      absorbedActivities: absorbed,
    },
  };
}

function normalizeMealInfo(value: unknown): MealInfo | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const noteFor = (slot: 'breakfast' | 'lunch' | 'dinner') => {
    const note = source[`${slot}_note`];
    if (typeof note === 'string' && note.trim()) return note.trim();
    const raw = source[slot];
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  };
  const breakfastNote = noteFor('breakfast');
  const lunchNote = noteFor('lunch');
  const dinnerNote = noteFor('dinner');
  return {
    breakfast: Boolean(source.breakfast) || Boolean(breakfastNote),
    lunch: Boolean(source.lunch) || Boolean(lunchNote),
    dinner: Boolean(source.dinner) || Boolean(dinnerNote),
    breakfast_note: breakfastNote,
    lunch_note: lunchNote,
    dinner_note: dinnerNote,
  };
}

function resolveDays(pkg: RenderPackageInput): CanonicalDay[] {
  const days = pkg.itinerary_data?.days ?? [];
  if (!Array.isArray(days) || days.length === 0) return [];

  return days.map((sourceDay, idx) => {
    const d = normalizeStructuredDayEntities(sourceDay as unknown as Parameters<typeof normalizeStructuredDayEntities>[0]);
    const isLastDay = idx === days.length - 1;
    const origSchedule = Array.isArray(d?.schedule)
      ? (d.schedule as ScheduleItem[]).map(item => (
          item?.a4_sentence ? { ...item, activity: item.a4_sentence } : item
        ))
      : [];

    // 1) 도착-only flight 아이템 사전 필터 (ERR-HSN-flight-dup-render 의 DetailClient:718 로직 이관)
    const dedupedFlight = origSchedule.filter((item, i) => {
      if (item?.type !== 'flight') return true;
      const act = item.activity || '';
      const isArrivalOnly = /도착/.test(act) && !/출발/.test(act);
      const prev = origSchedule[i - 1];
      // 직전 아이템이 flight 이면서 → 토큰이 없으면 (즉 아직 미병합 쌍) 이 도착-only 는 다음 단계에서 흡수
      if (isArrivalOnly && prev?.type === 'flight' && !/→|↦|⇒/.test(prev.activity || '')) return true; // keep, 다음 merge 에서 합침
      return true;
    });

    // 2) 출발·도착 쌍 → 단일 flight label 로 병합
    const { merged, flight } = mergeLegacyFlightPair(dedupedFlight);

    // 3) ARRIVAL_MARKER_RE 로 type='normal' 도착 중복 표시 스킵
    const deArrivaled = merged.filter((item) => {
      if (item?.type === 'flight') return true;
      return !ARRIVAL_MARKER_RE.test(item?.activity || '');
    });

    // 4) 호텔 activity → hotelCard 분리
    const { schedule, hotelCard } = extractHotelCard(deArrivaled, d?.hotel as HotelInfo | null | undefined, isLastDay);

    return {
      day: typeof d?.day === 'number' ? d.day : idx + 1,
      regions: Array.isArray(d?.regions) ? (d.regions as string[]) : [],
      schedule,
      flight,
      hotelCard,
      meals: normalizeMealInfo(d?.meals),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  퍼블릭 엔트리
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 렌더링 계약 단일 진입점.
 *
 * **사용**:
 * ```tsx
 * import { renderPackage } from '@/lib/render-contract';
 * const view = renderPackage(pkg);
 * // A4·Mobile 공통: view.inclusions.basic / view.days[i].hotelCard / view.days[i].flight
 * ```
 *
 * **원칙**: 렌더러는 이 함수 출력만 소비한다. `pkg.excludes`·`pkg.surcharges`·
 * `pkg.special_notes`·`pkg.airline`·`pkg.inclusions`·`pkg.itinerary_data.days[].schedule` 를
 * 렌더러 내부에서 다시 파싱하지 말 것 (ERR-KUL-05, ERR-HSN-render-bundle).
 */
export function renderPackage(
  pkg: RenderPackageInput,
  options?: { affiliate?: AffiliateCoBrand | null },
): CanonicalView {
  const { merged, excludes } = resolveSurchargesAndExcludes(pkg);
  const days = resolveDays(pkg);
  const optionalTours = resolveOptionalTours(pkg);
  const shopping = resolveShopping(pkg);
  return {
    airlineHeader: resolveAirlineHeader(pkg),
    flightHeader: resolveFlightHeader(days, pkg),
    cruiseSchedule: resolveCruiseSchedule(pkg),
    optionalTours,
    optionalToursByRegion: optionalTours.groups,
    surchargesMerged: merged,
    excludes,
    shopping,
    termsMisc: resolveTermsMisc(shopping),
    inclusions: resolveInclusions(pkg),
    days,
    affiliateView: options?.affiliate ?? null,
  };
}

/** Cruise/Ferry 전용 — itinerary_data.cruise_schedule 또는 본문에서 스케줄 추출 (UX-4, 2026-05-14).
 *  현재는 패키지 데이터에 cruise_schedule 필드가 박혀있지 않으니, isFerryPackage 일 때
 *  airline + destination 으로 기본 라벨 생성. (향후 parser 에서 정밀 추출 박을 수 있음) */
function resolveCruiseSchedule(pkg: RenderPackageInput): CruiseSchedule | null {
  if (!isFerryPackage(pkg)) return null;
  const vesselName = pkg.airline ?? null;
  // departure_airport 가 "부산" 같이 city → outbound 라벨
  const dep = pkg.departure_airport ?? null;
  const arr = pkg.destination?.split(/[\/,]/)[0]?.trim() ?? null;
  const outboundLabel = dep && arr ? `${dep} → ${arr}` : null;
  const inboundLabel = dep && arr ? `${arr} → ${dep}` : null;
  return {
    outboundLabel,
    inboundLabel,
    vesselName,
    cabinNote: '다인실 기준',
  };
}

/**
 * 출발편/귀국편 헤더 추출. flight_segments 정규 필드 우선 (2026-05-13 박제 — normalize-flight-segments).
 * 없으면 days[0].flight / last.flight / beforeLast.flight fallback.
 */
function resolveFlightHeader(days: CanonicalDay[], pkg?: RenderPackageInput): FlightHeader {
  // Ferry/Cruise 는 항공편 헤더 자체를 노출하지 않음 (2026-05-14 박제)
  if (pkg && isFerryPackage(pkg)) {
    return { outbound: null, inbound: null };
  }
  // 1차: flight_segments 정규 필드 (SSOT)
  const segments = (pkg?.itinerary_data as { flight_segments?: Array<{
    leg: 'outbound' | 'inbound';
    flight_no: string | null;
    dep_airport: string | null;
    dep_time: string | null;
    arr_airport: string | null;
    arr_time: string | null;
    arr_day_offset: 0 | 1;
  }> } | undefined)?.flight_segments;

  if (Array.isArray(segments) && segments.length > 0) {
    const toFlight = (seg: typeof segments[number]): CanonicalFlight => ({
      code:         seg.flight_no,
      airlineName:  getAirlineName(seg.flight_no),
      airlineLabel: seg.flight_no
        ? (getAirlineName(seg.flight_no) ? `${seg.flight_no}(${getAirlineName(seg.flight_no)})` : seg.flight_no)
        : null,
      depCity:      seg.dep_airport,
      arrCity:      seg.arr_airport,
      depTime:      seg.dep_time,
      arrTime:      seg.arr_time,
      label:        `${seg.dep_airport ?? ''} 출발 → ${seg.arr_airport ?? ''} 도착`.trim(),
      arrDayOffset: seg.arr_day_offset,
    });
    const outboundSeg = segments.find(s => s.leg === 'outbound') ?? segments[0];
    const inboundSeg  = segments.find(s => s.leg === 'inbound')  ?? (segments.length > 1 ? segments[segments.length - 1] : null);
    const outbound = outboundSeg ? toFlight(outboundSeg) : null;
    const inbound  = inboundSeg  ? toFlight(inboundSeg)  : null;
    // segment arr_time 누락 시 day.flight(mergeLegacyFlightPair) 백필 — 헤더·타임라인 불일치 방지
    if (outbound && !outbound.arrTime && days[0]?.flight?.arrTime) {
      outbound.arrTime = days[0].flight.arrTime;
      if (!outbound.arrCity && days[0].flight.arrCity) outbound.arrCity = days[0].flight.arrCity;
    }
    const lastDay = days[days.length - 1];
    const beforeLast = days.length >= 2 ? days[days.length - 2] : null;
    const legacyInbound = lastDay?.flight ?? beforeLast?.flight ?? null;
    if (inbound && !inbound.arrTime && legacyInbound?.arrTime) {
      inbound.arrTime = legacyInbound.arrTime;
      if (!inbound.arrCity && legacyInbound.arrCity) inbound.arrCity = legacyInbound.arrCity;
    }
    return { outbound, inbound };
  }

  // 2차: legacy fallback
  if (days.length === 0) return { outbound: null, inbound: null };
  const outbound = days[0]?.flight ?? null;
  const last = days[days.length - 1];
  const beforeLast = days.length >= 2 ? days[days.length - 2] : null;
  const inbound = last?.flight ?? beforeLast?.flight ?? null;
  return { outbound, inbound };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Flight / City 활동 파서 (F2 추가 — DetailClient 의 지역 파서 이관)
//  ERR-20260418-22, ERR-FUK-flight, ERR-FUK-flight-arrival 대응
// ═══════════════════════════════════════════════════════════════════════════

/** "BX143 후쿠오카국제공항" 같이 flight code prefix 포함 시 도시만 추출 */
export function parseCityFromActivity(activity?: string | null): string | null {
  if (!activity) return null;
  // flight code (2~5자 대문자+숫자) prefix 제거
  const cleaned = activity.replace(/^[A-Z0-9]{2,5}\s+/, '').trim();
  const m = cleaned.match(/^(.+?)[\s·]*(?:국제)?공항/);
  return m ? m[1].trim() : null;
}

/**
 * flight 타입 activity 문자열 파싱.
 * 입력 예 1: "BX792 타이페이 출발 → 부산(김해) 도착 19:55"
 * 입력 예 2: "BX148 김해국제공항 출발 → 후쿠오카국제공항 08:25 도착"
 *
 * 매칭 전략 — 2단 (strict → loose) 폴백:
 *   1) "공항" 키워드 포함: "김해국제공항 출발" → depCity="김해" (capture non-greedy)
 *   2) "공항" 없는 평문: "타이페이 출발" → depCity="타이페이"
 * 이전 단일 정규식 `공항?` 는 "공" 만 필수로 인식해서 (a) "타이페이 출발" 은 매칭 실패,
 * (b) "후쿠오카국제공항" 도착은 "후쿠오카국제" 까지 over-capture 되던 한계가 있었음.
 */
export function parseFlightActivity(activity?: string | null): {
  depCity: string | null;
  arrCity: string | null;
  arrTime: string | null;
} {
  if (!activity) return { depCity: null, arrCity: null, arrTime: null };
  const arrowIdx = activity.search(/[→↦⇒]/);
  if (arrowIdx < 0) return { depCity: null, arrCity: null, arrTime: null };
  const before = activity.slice(0, arrowIdx);
  const after = activity.slice(arrowIdx + 1);

  // 출발: 공항 키워드 strict 매칭 → 없으면 평문 매칭
  const depMatch =
    // "BX148 김해국제공항 출발" / "김해국제공항 출발" → "김해"
    before.match(/(?:^|[A-Z0-9]+\s+)([가-힣A-Za-z()]+?(?:\s[가-힣A-Za-z()]+)?)\s*(?:국제)?공항\s*출발/)
    // "BX792 타이페이 출발" / "타이페이 출발" → "타이페이"
    || before.match(/(?:^|[A-Z0-9]+\s+)([가-힣A-Za-z()]+?(?:\s[가-힣A-Za-z()]+)?)\s*출발/);

  // 도착: 동일 2단 폴백
  const arrMatch =
    // "후쿠오카국제공항 08:25 도착" → "후쿠오카"
    after.match(/^\s*([가-힣A-Za-z()]+?(?:\s[가-힣A-Za-z()]+)?)\s*(?:국제)?공항\s*(?:\d{1,2}:\d{2}\s*)?도착/)
    // "부산(김해) 도착 19:55" → "부산(김해)"
    || after.match(/^\s*([가-힣A-Za-z()]+?(?:\s[가-힣A-Za-z()]+)?)\s*(?:\d{1,2}:\d{2}\s*)?도착/);

  // 도착 시간: "도착 HH:MM" 또는 "HH:MM 도착" 양방향 지원
  const arrTimeMatch = after.match(/도착\s+(\d{1,2}:\d{2})/) || after.match(/(\d{1,2}:\d{2})\s*도착/);
  return {
    depCity: depMatch?.[1]?.trim() || null,
    arrCity: arrMatch?.[1]?.trim() || null,
    arrTime: arrTimeMatch?.[1] || null,
  };
}

/** flight code 기반 간결 라벨: "에어부산 BX143" (매치 안 되면 원본 유지) */
export function formatFlightLabel(transport?: string | null): string {
  if (!transport) return '';
  const name = getAirlineName(transport);
  return name ? `${name} ${transport}` : transport;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Re-exports (렌더러/테스트가 공통 타입을 한 곳에서 import)
// ═══════════════════════════════════════════════════════════════════════════

export type {
  OptionalTourInput,
  NormalizedOptionalTour,
  OptionalTourGroup,
} from './itinerary-render';
