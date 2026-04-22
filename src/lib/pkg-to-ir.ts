/**
 * @file pkg-to-ir.ts — Phase 1.5-β/γ 공용 역변환기
 *
 * travel_packages pkg → NormalizedIntake (IR)
 *
 * 용도:
 *   β) 어셈블러 어댑터: assembler_*.js 가 buildProduct() 결과 pkg 를 IR 로 변환 → `/api/register-via-ir engine=direct` 로 통합
 *   γ) 레거시 감사: 기존 362개 pkg 를 IR 로 역변환해 lossless·정합성 검증
 *
 * 제한:
 *   - 완전 lossless 아님 — pkg 평탄 activity 문자열에서 segment kind 추정 (휴리스틱)
 *   - rawText 가 pkg 에 없으면 재구성 불가 → raw_text 필드 있는 경우만 완전 변환
 *   - attractionNames 는 activity text 에서 ▶ 뒤 텍스트 추출
 */

import crypto from 'crypto';
import type { NormalizedIntake, IntakeSegment, IntakePriceGroup, IntakeSurcharge, IntakeNoticeBlock, IntakeFlightSegment } from './intake-normalizer';
import { NORMALIZER_VERSION } from './intake-normalizer';

type AnyObj = Record<string, unknown>;

interface PkgLike {
  title?: string | null;
  destination?: string | null;
  country?: string | null;
  product_type?: string | null;
  trip_style?: string | null;
  duration?: number | null;
  nights?: number | null;
  departure_airport?: string | null;
  departure_days?: string | string[] | null;
  airline?: string | null;
  min_participants?: number | null;
  ticketing_deadline?: string | null;
  price?: number | null;
  surcharges?: AnyObj[] | null;
  optional_tours?: AnyObj[] | null;
  price_tiers?: AnyObj[] | null;
  price_dates?: AnyObj[] | null;
  inclusions?: string[] | null;
  excludes?: string[] | null;
  notices_parsed?: IntakeNoticeBlock[] | null;
  accommodations?: string[] | null;
  itinerary_data?: {
    meta?: AnyObj | null;
    days?: AnyObj[] | null;
  } | null;
  raw_text?: string | null;
  commission_rate?: number | string | null;
  land_operator_id?: string | null;
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function classifySegmentKind(activity: string): IntakeSegment['kind'] {
  const a = activity.trim();
  if (/^[*※]/.test(a)) return 'note';
  if (/^[♡♦★]/.test(a) || /특전/.test(a)) return 'special';
  if (/호텔.*(?:투숙|휴식|체크)/.test(a) || /투숙.*휴식/.test(a)) return 'hotel-check';
  if (/^(?:호텔\s*)?(?:조식|중식|석식|조식후|석식후)/.test(a)) return 'meal';
  if (/이동.*소요|이동\s*\(/.test(a)) return 'transit';
  if (a.startsWith('▶')) return 'attraction';
  // 흔한 "공항 이동/체크인" 등
  if (/이동|출발|도착/.test(a) && !a.startsWith('▶')) return 'transit';
  return 'misc';
}

function extractAttractionNames(activity: string): string[] {
  const a = activity.replace(/^▶\s*/, '').trim();
  // "A & B" 또는 "A, B" 개별 분리
  const split = a.split(/\s*(?:&|,|，)\s*/);
  return split.map((s) => s.replace(/\s*\(.*?\)\s*$/, '').trim()).filter(Boolean);
}

function scheduleItemToSegment(item: AnyObj): IntakeSegment | null {
  const activity = typeof item.activity === 'string' ? item.activity : '';
  if (!activity) return null;
  const kind = classifySegmentKind(activity);
  const base: IntakeSegment = { kind };
  base.rawLabel = activity;

  switch (kind) {
    case 'attraction': {
      base.attractionNames = extractAttractionNames(activity);
      base.canonicalLabel = base.attractionNames[0] || activity;
      const parenMatch = activity.match(/\(([^)]+)\)/);
      if (parenMatch) {
        base.subItems = parenMatch[1].split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      }
      const note = typeof item.note === 'string' ? item.note : null;
      if (note) base.rawDescription = note;
      break;
    }
    case 'transit': {
      const toMatch = activity.match(/^(.+?)\s*(?:이동|향발)/);
      if (toMatch) base.to = toMatch[1].trim();
      const durMatch = activity.match(/\(([^)]*(?:시간|분)[^)]*)\)/);
      if (durMatch) base.durationText = durMatch[1].trim();
      break;
    }
    case 'note':
    case 'special':
    case 'misc': {
      base.text = activity.replace(/^[*※♡♦★]\s*/, '').trim();
      if (kind === 'special') {
        const iconMatch = activity.match(/^([♡♦★])/);
        if (iconMatch) base.icon = iconMatch[1];
      }
      break;
    }
    case 'meal': {
      base.text = activity;
      if (/조식/.test(activity)) base.mealType = 'breakfast';
      else if (/중식/.test(activity)) base.mealType = 'lunch';
      else if (/석식/.test(activity)) base.mealType = 'dinner';
      break;
    }
    case 'hotel-check': {
      base.text = activity;
      break;
    }
  }
  return base;
}

function detectDepartureDays(raw: string | string[] | null | undefined): string | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw.join('/');
  const s = String(raw).trim();
  if (!s) return null;
  // JSON 배열 문자열 방어 (ERR-KUL-01)
  if (s.startsWith('[')) {
    try { return (JSON.parse(s) as string[]).join('/'); } catch { return s; }
  }
  return s;
}

function inferTripStyle(duration: number | null | undefined, nights: number | null | undefined): string {
  const d = duration || 0;
  const n = nights ?? Math.max(d - 1, 0);
  return `${n}박${d}일`;
}

function inferProductType(raw: string | null | undefined): NormalizedIntake['meta']['productType'] {
  const s = (raw || '').toLowerCase();
  if (s.includes('노팁') && s.includes('노옵션')) return '노팁노옵션';
  if (s.includes('노팁풀옵션')) return '노팁풀옵션';
  if (s.includes('노쇼핑')) return '노쇼핑';
  if (s.includes('고품격')) return '고품격';
  if (s.includes('품격')) return '품격';
  if (s.includes('실속')) return '실속';
  if (s.includes('골프')) return '골프';
  return '패키지';
}

function flightFromMeta(meta: AnyObj | null | undefined, dayIdx: number, days: AnyObj[]): IntakeFlightSegment | null {
  const m = meta || {};
  const isFirst = dayIdx === 0;
  const isLast = dayIdx === days.length - 1;
  const code = (isFirst ? (m.flight_out as string) : isLast ? (m.flight_in as string) : null) || null;
  if (!code) return null;
  const depAirport = isFirst
    ? (m.departure_airport as string) || '출발지'
    : ((days[dayIdx]?.regions as string[])?.[0] || '?');
  const arrAirport = isLast
    ? (m.departure_airport as string) || '도착지'
    : ((days[dayIdx]?.regions as string[])?.[1] || '?');
  // 시간은 pkg 에 meta 레벨로는 없음 — day.schedule 의 flight item 에서 추정
  const sch = (days[dayIdx]?.schedule as AnyObj[]) || [];
  const flightItems = sch.filter((s) => s.type === 'flight');
  const depTime = (flightItems[0]?.time as string) || '--:--';
  const arrTimeGuess = (flightItems[1]?.time as string) || '--:--';
  return {
    code,
    departure: { airport: depAirport, time: depTime },
    arrival: { airport: arrAirport, time: arrTimeGuess },
  };
}

function priceTiersToGroups(tiers: AnyObj[] | null | undefined): IntakePriceGroup[] {
  const DOW = new Set(['월','화','수','목','금','토','일']);
  return (tiers || []).map((t) => {
    const label = (t.period_label as string) || '기간';
    const dates = Array.isArray(t.departure_dates) ? (t.departure_dates as string[]) : null;
    const range = (t.date_range as { start?: string; end?: string }) || null;
    const dow = t.departure_day_of_week as string | undefined;
    return {
      label,
      dates,
      dateRange: range?.start && range?.end ? { start: range.start, end: range.end } : null,
      dayOfWeek: dow && DOW.has(dow) ? (dow as IntakePriceGroup['dayOfWeek']) : null,
      adultPrice: (t.adult_price as number) || 0,
      childPrice: (t.child_price as number | null) ?? null,
      confirmed: (t.status as string) === 'confirmed' || /출확|출발확정/.test((t.note as string) || ''),
      surchargeIncluded: false,
      surchargeNote: (t.note as string | null) ?? null,
    };
  });
}

function surchargesToIr(arr: AnyObj[] | null | undefined): IntakeSurcharge[] {
  return (arr || []).map((s) => {
    const currency = (s.currency as string) || 'KRW';
    const safeCurrency: IntakeSurcharge['currency'] = (
      ['KRW', 'USD', 'CNY', 'JPY', 'EUR'].includes(currency) ? currency : 'KRW'
    ) as IntakeSurcharge['currency'];
    return {
      name: (s.name as string) || '써차지',
      start: (s.start as string | null) ?? null,
      end: (s.end as string | null) ?? null,
      amount: Number(s.amount) || 0,
      currency: safeCurrency,
      unit: (s.unit as string | null) ?? null,
    };
  });
}

function normalizeNoticesForIr(arr: unknown): IntakeNoticeBlock[] {
  if (!Array.isArray(arr)) return [];
  const VALID = new Set(['INFO', 'CRITICAL', 'PAYMENT', 'POLICY', 'FLIGHT']);
  const out: IntakeNoticeBlock[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const n = raw as AnyObj;
    const type = (typeof n.type === 'string' && VALID.has(n.type)) ? (n.type as IntakeNoticeBlock['type']) : 'INFO';
    const title = typeof n.title === 'string' && n.title.trim() ? n.title.trim() : '(제목 없음)';
    const text = typeof n.text === 'string' && n.text.trim()
      ? n.text.trim()
      : typeof n.content === 'string'
        ? (n.content as string).trim()
        : '';
    if (!text) continue;
    out.push({ type, title, text });
  }
  return out;
}

function hotelsFromAccommodations(accoms: string[] | null | undefined, nights: number): NormalizedIntake['hotels'] {
  return (accoms || []).map((a) => {
    const m = a.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    return {
      name: m ? m[1].trim() : a,
      grade: m ? m[2].trim() : '',
      nights,
    };
  });
}

export interface PkgToIrResult {
  ir: NormalizedIntake;
  warnings: string[];
}

/**
 * pkg → IR 역변환. lossless 는 아니지만 핵심 구조 복원.
 *
 * @param pkg  travel_packages row
 * @param options landOperator 이름 (ACL 조회 없이 문자열)
 */
export function pkgToIntake(pkg: PkgLike, options: { landOperatorName?: string } = {}): PkgToIrResult {
  const warnings: string[] = [];
  const meta = pkg.itinerary_data?.meta || {};
  const days = Array.isArray(pkg.itinerary_data?.days) ? pkg.itinerary_data!.days! : [];

  const rawText = pkg.raw_text || '';
  if (!rawText) warnings.push('raw_text 없음 — IR rawText 가 빈 문자열. lossless 아님.');

  // days
  const irDays = days.map((d, idx) => {
    const dAny = d as AnyObj;
    const schedule = Array.isArray(dAny.schedule) ? (dAny.schedule as AnyObj[]) : [];
    const segments = schedule
      .map((s) => scheduleItemToSegment(s))
      .filter((s): s is IntakeSegment => s !== null && s.kind !== 'misc' || (s?.text?.length ?? 0) > 0);

    const hotel = dAny.hotel as AnyObj | null;
    const mealsRaw = (dAny.meals as AnyObj) || {};

    return {
      day: typeof dAny.day === 'number' ? dAny.day : idx + 1,
      regions: Array.isArray(dAny.regions) ? (dAny.regions as string[]) : [],
      flight: flightFromMeta(meta, idx, days),
      hotelName: (hotel?.name as string | null) ?? null,
      meals: {
        breakfast: Boolean(mealsRaw.breakfast),
        breakfastNote: (mealsRaw.breakfast_note as string | null) ?? null,
        lunch: Boolean(mealsRaw.lunch),
        lunchNote: (mealsRaw.lunch_note as string | null) ?? null,
        dinner: Boolean(mealsRaw.dinner),
        dinnerNote: (mealsRaw.dinner_note as string | null) ?? null,
      },
      segments,
    };
  });

  const ir: NormalizedIntake = {
    meta: {
      landOperator: options.landOperatorName || '(unknown)',
      region: pkg.destination || '?',
      country: pkg.country || '?',
      tripStyle: pkg.trip_style || inferTripStyle(pkg.duration, pkg.nights),
      productType: inferProductType(pkg.product_type),
      commissionRate: Number(pkg.commission_rate) || 0,
      ticketingDeadline: pkg.ticketing_deadline || null,
      minParticipants: pkg.min_participants ?? 4,
      departureAirport: pkg.departure_airport || '?',
      airline: pkg.airline || '?',
      departureDays: detectDepartureDays(pkg.departure_days),
    },
    flights: {
      outbound: irDays[0]?.flight ? [irDays[0].flight] : [],
      inbound: irDays.length > 0 && irDays[irDays.length - 1]?.flight ? [irDays[irDays.length - 1].flight!] : [],
    },
    priceGroups: priceTiersToGroups(pkg.price_tiers),
    hotels: hotelsFromAccommodations(pkg.accommodations, pkg.nights ?? 0),
    inclusions: pkg.inclusions || [],
    excludes: pkg.excludes || [],
    surcharges: surchargesToIr(pkg.surcharges),
    optionalTours: (pkg.optional_tours || []).map((ot) => ({
      name: (ot.name as string) || '?',
      region: (ot.region as string) || pkg.destination || '?',
      priceLabel: (ot.price as string) || String(ot.price_usd || ot.price_krw || ''),
      note: (ot.note as string | null) ?? null,
    })),
    days: irDays,
    notices: {
      manual: normalizeNoticesForIr(pkg.notices_parsed),
      auto: [],
    },
    rawText,
    rawTextHash: rawText ? sha256(rawText) : '',
    normalizerVersion: `${NORMALIZER_VERSION}-reverse`,
    extractedAt: new Date().toISOString(),
  };

  // lossless 검증 — 주요 필드 누락 경고
  if (!ir.meta.airline || ir.meta.airline === '?') warnings.push('airline 누락');
  if (!ir.priceGroups.length) warnings.push('priceGroups 비어있음 (price_tiers 없음)');
  if (!ir.hotels.length) warnings.push('hotels 비어있음 (accommodations 없음)');
  if (!ir.inclusions.length) warnings.push('inclusions 비어있음');
  if (ir.days.some((d) => d.segments.length === 0)) warnings.push('일부 day 의 segments 가 비어있음');

  return { ir, warnings };
}
