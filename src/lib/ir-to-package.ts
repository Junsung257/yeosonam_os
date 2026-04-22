/**
 * @file ir-to-package.ts — Phase 1.5 IR → pkg 기계 변환
 *
 * NormalizedIntake(IR) 를 기존 travel_packages 스키마로 lossless 변환.
 *
 * 원칙:
 *   1. LLM 호출 없음 — 결정론적 변환
 *   2. 관광지 lookup 실패 허용 — rawLabel + rawDescription fallback 으로 렌더 가능
 *   3. 미매칭은 unmatched_activities 에 자동 큐잉
 *   4. manual + auto 약관 병합 (terms-library)
 *   5. Idempotent — 같은 IR 여러 번 호출해도 같은 pkg 산출
 *
 * 관련:
 *   - attraction-matcher.ts (매칭 재활용)
 *   - terms-library.ts (auto 약관)
 *   - render-contract.ts (view 계약은 아래 레이어)
 */

import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  NormalizedIntake,
  IntakeSegment,
  IntakePriceGroup,
  IntakeSurcharge,
  IntakeNoticeBlock,
} from './intake-normalizer';
import {
  buildAttractionIndex,
  matchAttractionIndexed,
  type AttractionData,
  type AttractionIndex,
} from './attraction-matcher';
import { resolveRequiredTerms, mergeNotices } from './terms-library';

// ═══════════════════════════════════════════════════════════════════════════
//  pkg 출력 타입 (travel_packages 컬럼 부분집합)
// ═══════════════════════════════════════════════════════════════════════════

export interface PackageDraft {
  title: string;
  destination: string;
  country: string;
  category: string;
  product_type: string;
  trip_style: string;
  duration: number;
  nights: number;
  departure_airport: string;
  departure_days: string | null;
  airline: string;
  min_participants: number;
  status: string;
  price: number;
  surcharges: Array<Record<string, unknown>>;
  excluded_dates: string[];
  optional_tours: Array<Record<string, unknown>>;
  price_tiers: Array<Record<string, unknown>>;
  inclusions: string[];
  excludes: string[];
  notices_parsed: IntakeNoticeBlock[];
  special_notes: string | null;
  product_highlights: string[];
  product_summary: string | null;
  product_tags: string[];
  itinerary_data: Record<string, unknown>;
  itinerary: string[];
  accommodations: string[];
  raw_text: string;
  raw_text_hash: string;
  parser_version: string;
  ticketing_deadline: string | null;
  filename: string;
  file_type: string;
  confidence: number;
}

export interface ConversionResult {
  pkg: PackageDraft;
  unmatchedSegments: Array<{
    dayIndex: number;
    segmentIndex: number;
    kind: string;
    rawLabel: string | null;
    attractionNames: string[];
  }>;
  matchedAttractionCount: number;
  noticesAutoCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  내부 헬퍼
// ═══════════════════════════════════════════════════════════════════════════

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function priceGroupToTier(pg: IntakePriceGroup): Record<string, unknown> {
  const tier: Record<string, unknown> = {
    period_label: pg.label,
    adult_price: pg.adultPrice,
    child_price: pg.childPrice,
    status: pg.confirmed ? 'confirmed' : 'available',
    note: pg.surchargeNote,
  };
  if (pg.dates && pg.dates.length > 0) {
    tier.departure_dates = pg.dates;
  }
  if (pg.dateRange && pg.dayOfWeek) {
    tier.date_range = pg.dateRange;
    tier.departure_day_of_week = pg.dayOfWeek;
  }
  return tier;
}

function surchargeToObject(s: IntakeSurcharge): Record<string, unknown> {
  return {
    name: s.name,
    start: s.start,
    end: s.end,
    amount: s.amount,
    currency: s.currency,
    unit: s.unit,
  };
}

/** 세그먼트를 일정표 평탄 string 으로 변환 (pkg.itinerary[] 과 day.schedule 용) */
function segmentToScheduleItem(seg: IntakeSegment): Record<string, unknown> | null {
  switch (seg.kind) {
    case 'attraction': {
      const label = seg.canonicalLabel || seg.attractionNames?.[0] || seg.rawLabel || '';
      if (!label) return null;
      const subText = seg.subItems && seg.subItems.length > 0 ? ` (${seg.subItems.join(', ')})` : '';
      return {
        time: null,
        activity: `▶${label}${subText}`,
        type: 'normal',
        transport: null,
        note: seg.rawDescription || null,
      };
    }
    case 'transit': {
      const duration = seg.durationText ? ` (${seg.durationText})` : '';
      return {
        time: null,
        activity: `${seg.to || '이동'}${duration}`,
        type: 'normal',
        transport: null,
        note: null,
      };
    }
    case 'note': {
      return {
        time: null,
        activity: `※ ${seg.text || ''}`,
        type: 'normal',
        transport: null,
        note: null,
      };
    }
    case 'special': {
      const icon = seg.icon || '♡';
      return {
        time: null,
        activity: `${icon}특전: ${seg.text || ''}`,
        type: 'normal',
        transport: null,
        note: null,
      };
    }
    case 'meal': {
      // day.meals (bool summary) 가 주 정보. 여기선 위치 기반 텍스트만.
      if (!seg.text) return null;
      return {
        time: null,
        activity: seg.text,
        type: 'normal',
        transport: null,
        note: null,
      };
    }
    case 'hotel-check': {
      return {
        time: null,
        activity: seg.text || '호텔 투숙 및 휴식',
        type: 'normal',
        transport: null,
        note: seg.note || null,
      };
    }
    case 'misc': {
      if (!seg.text && !seg.rawLabel) return null;
      return {
        time: null,
        activity: seg.text || seg.rawLabel || '',
        type: 'normal',
        transport: null,
        note: null,
      };
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  메인 변환 함수
// ═══════════════════════════════════════════════════════════════════════════

export interface ConvertOptions {
  /** Supabase 클라이언트 (null 이면 attraction lookup·약관 DB 조회 생략) */
  sb?: SupabaseClient | null;
  /** 미리 로드된 attractions (배치 처리용) */
  preloadedAttractions?: AttractionData[];
  /** pkg.status 지정 (기본 'pending') */
  status?: string;
  /** pkg.filename 지정 */
  filename?: string;
}

export async function convertIntakeToPackage(
  ir: NormalizedIntake,
  options: ConvertOptions = {},
): Promise<ConversionResult> {
  const { sb = null, preloadedAttractions = null, status = 'pending', filename } = options;

  // 1) Attraction 인덱스 구축 (lookup 준비)
  let attractionIndex: AttractionIndex | null = null;
  if (preloadedAttractions) {
    attractionIndex = buildAttractionIndex(preloadedAttractions, ir.meta.region);
  } else if (sb) {
    const { data: attrs } = await sb
      .from('attractions')
      .select('id, name, short_desc, long_desc, badge_type, emoji, country, region, category, aliases, photos')
      .eq('is_active', true);
    if (Array.isArray(attrs)) {
      attractionIndex = buildAttractionIndex(attrs as AttractionData[], ir.meta.region);
    }
  }

  // 2) days[] 변환 — segment → schedule 평탄화 + 관광지 matching
  const unmatchedSegments: ConversionResult['unmatchedSegments'] = [];
  let matchedAttractionCount = 0;
  const pkgDays: Array<Record<string, unknown>> = [];
  const itineraryStrings: string[] = [];

  ir.days.forEach((d, dIdx) => {
    // Flight 활동 — IR 의 day.flight 가 단일 객체. CRC 계약과 매치되는 "A 출발 → B 도착 HH:MM" 단일 activity 로 변환
    const flightItem =
      d.flight
        ? {
            time: d.flight.departure.time || null,
            activity: `${d.flight.departure.airport} 출발 → ${d.flight.arrival.airport} 도착 ${d.flight.arrival.time}`.trim(),
            type: 'flight',
            transport: d.flight.code,
            note: null,
          }
        : null;

    // Segment 순회 — attraction 은 lookup 시도
    const segmentItems: Record<string, unknown>[] = [];
    d.segments.forEach((seg, sIdx) => {
      if (seg.kind === 'attraction' && attractionIndex) {
        const names = seg.attractionNames || [];
        let anyMatched = false;
        // 여러 이름이 하나의 attraction segment 에 있으면 각각 개별 schedule item 으로 분리
        for (const name of names) {
          const match = matchAttractionIndexed(name, attractionIndex);
          if (match) {
            matchedAttractionCount++;
            anyMatched = true;
            segmentItems.push({
              time: null,
              activity: `▶${name}`,
              type: 'normal',
              transport: null,
              note: seg.rawDescription || match.short_desc || null,
              attraction_id: match.id,
            });
          } else {
            // 매칭 실패 — rawLabel + rawDescription 으로 렌더 fallback
            segmentItems.push({
              time: null,
              activity: `▶${name}`,
              type: 'normal',
              transport: null,
              note: seg.rawDescription || null,
            });
            unmatchedSegments.push({
              dayIndex: dIdx,
              segmentIndex: sIdx,
              kind: seg.kind,
              rawLabel: seg.rawLabel || name,
              attractionNames: [name],
            });
          }
        }
        if (!anyMatched && names.length === 0) {
          // 이름 배열 자체가 없으면 rawLabel 만 fallback
          const item = segmentToScheduleItem(seg);
          if (item) segmentItems.push(item);
        }
      } else {
        const item = segmentToScheduleItem(seg);
        if (item) segmentItems.push(item);
        if (seg.kind === 'misc') {
          unmatchedSegments.push({
            dayIndex: dIdx,
            segmentIndex: sIdx,
            kind: seg.kind,
            rawLabel: seg.rawLabel || seg.text || null,
            attractionNames: [],
          });
        }
      }
    });

    // schedule: flight + segments 순서 병합 (flight 는 일반적으로 처음 또는 끝)
    const schedule = flightItem
      ? [flightItem, ...segmentItems]
      : segmentItems;

    // hotel: root.hotels 에서 name 매칭
    const hotel = d.hotelName
      ? (() => {
          const matched = ir.hotels.find((h) => h.name === d.hotelName);
          return matched
            ? { name: matched.name, grade: matched.grade || null, note: null }
            : { name: d.hotelName, grade: null, note: null };
        })()
      : { name: null, grade: null, note: null };

    pkgDays.push({
      day: d.day,
      regions: d.regions,
      meals: {
        breakfast: d.meals.breakfast,
        lunch: d.meals.lunch,
        dinner: d.meals.dinner,
        breakfast_note: d.meals.breakfastNote,
        lunch_note: d.meals.lunchNote,
        dinner_note: d.meals.dinnerNote,
      },
      schedule,
      hotel,
    });

    // itinerary[] — 요약 한 줄
    const regionsStr = d.regions.join(' → ');
    const firstAttraction = d.segments.find((s) => s.kind === 'attraction')?.attractionNames?.[0] || '';
    itineraryStrings.push(`제${d.day}일 (${regionsStr})${firstAttraction ? ` · ${firstAttraction}` : ''}`);
  });

  // 3) 자동 약관 조립
  const autoNotices = await resolveRequiredTerms(
    {
      country: ir.meta.country,
      region: ir.meta.region,
      productType: ir.meta.productType,
      airline: ir.meta.airline,
      flightCodes: [
        ...(ir.flights.outbound.map((f) => f.code) || []),
        ...(ir.flights.inbound.map((f) => f.code) || []),
      ],
      departureDate: ir.priceGroups?.[0]?.dates?.[0] || ir.priceGroups?.[0]?.dateRange?.start || null,
      ticketingDeadline: ir.meta.ticketingDeadline,
    },
    sb,
  );
  const allNotices = mergeNotices(ir.notices.manual, autoNotices);

  // 4) itinerary_data.meta 구성
  const meta = {
    title: `${ir.meta.region} ${ir.meta.tripStyle}`,
    product_type: ir.meta.productType,
    destination: ir.meta.region,
    nights: Math.max(ir.meta.tripStyle.match(/(\d+)박/)?.[1] ? Number(ir.meta.tripStyle.match(/(\d+)박/)![1]) : ir.days.length - 1, 0),
    days: ir.days.length,
    departure_airport: ir.meta.departureAirport,
    airline: ir.meta.airline,
    flight_out: ir.flights.outbound[0]?.code || null,
    flight_in: ir.flights.inbound[0]?.code || null,
    departure_days: ir.meta.departureDays,
    min_participants: ir.meta.minParticipants,
    room_type: '2인1실',
    ticketing_deadline: ir.meta.ticketingDeadline,
    hashtags: [`#${ir.meta.region}`],
    brand: '여소남',
  };

  // 5) 최저가 (price_groups 중 minimum)
  const allPrices = ir.priceGroups.map((pg) => pg.adultPrice).filter((p) => p > 0);
  const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : 0;

  // 6) accommodations — hotel name 유니크 배열
  const accommodations = ir.hotels.map((h) => `${h.name} (${h.grade})`);

  // 7) 타이틀 보강
  const title = `${ir.meta.productType === '노쇼핑' ? '【노쇼핑】 ' : ''}${ir.meta.region} ${ir.meta.tripStyle} (${ir.meta.airline})`;

  // 8) product_summary — 간단 요약 (LLM 없이)
  const summary = `${ir.meta.region} ${ir.meta.tripStyle} 상품입니다. ${ir.hotels[0]?.name || ''} (${ir.hotels[0]?.grade || ''}) 기준, ${ir.meta.airline} 이용. ${ir.meta.productType} 타입으로 구성되어 있어 ${ir.meta.productType === '노쇼핑' ? '쇼핑 부담 없이 일정에 집중하실 수 있습니다.' : '알차게 준비된 일정입니다.'}`;

  // 9) 최종 PackageDraft
  const pkg: PackageDraft = {
    title,
    destination: ir.meta.region,
    country: ir.meta.country,
    category: 'package',
    product_type: ir.meta.productType,
    trip_style: ir.meta.tripStyle,
    duration: ir.days.length,
    nights: meta.nights,
    departure_airport: ir.meta.departureAirport,
    departure_days: ir.meta.departureDays,
    airline: ir.meta.airline,
    min_participants: ir.meta.minParticipants,
    status,
    price: minPrice,
    surcharges: ir.surcharges.map(surchargeToObject),
    excluded_dates: [],
    optional_tours: ir.optionalTours.map((ot) => ({
      name: ot.name,
      region: ot.region,
      price: ot.priceLabel,
      note: ot.note,
    })),
    price_tiers: ir.priceGroups.map(priceGroupToTier),
    inclusions: ir.inclusions,
    excludes: ir.excludes,
    notices_parsed: allNotices,
    special_notes: null,
    product_highlights: [
      ...(ir.meta.productType === '노쇼핑' ? ['쇼핑 부담 없는 여행'] : []),
      ...(ir.meta.productType === '골프' ? ['무제한 그린피'] : []),
    ],
    product_summary: summary,
    product_tags: [`#${ir.meta.region}`, `#${ir.meta.productType}`],
    itinerary_data: {
      meta,
      highlights: {
        inclusions: ir.inclusions,
        excludes: ir.excludes,
        shopping: ir.meta.productType === '노쇼핑' ? '노쇼핑' : null,
        remarks: [],
      },
      days: pkgDays,
      optional_tours: ir.optionalTours.map((ot) => ({
        name: ot.name,
        region: ot.region,
        price: ot.priceLabel,
        note: ot.note,
      })),
    },
    itinerary: itineraryStrings,
    accommodations,
    raw_text: ir.rawText,
    raw_text_hash: ir.rawTextHash || sha256(ir.rawText),
    parser_version: `ir-to-package-v1.0 / ${ir.normalizerVersion}`,
    ticketing_deadline: ir.meta.ticketingDeadline,
    filename: filename || `ir-${Date.now()}`,
    file_type: 'ir',
    confidence: 0.95,
  };

  return {
    pkg,
    unmatchedSegments,
    matchedAttractionCount,
    noticesAutoCount: autoNotices.length,
  };
}

/** 미매칭 segments 를 unmatched_activities 에 일괄 큐잉 */
export async function queueUnmatchedSegments(
  sb: SupabaseClient,
  intakeId: string,
  packageId: string | null,
  unmatched: ConversionResult['unmatchedSegments'],
  normalizerVersion: string,
  country: string,
  region: string,
): Promise<void> {
  if (unmatched.length === 0) return;
  const rows = unmatched.map((u) => ({
    activity: u.attractionNames[0] || u.rawLabel || '(unknown)',
    package_id: packageId,
    day_number: u.dayIndex + 1,
    country,
    region,
    occurrence_count: 1,
    status: 'pending',
    segment_kind_guess: u.kind,
    raw_label: u.rawLabel,
    normalizer_version: normalizerVersion,
    intake_id: intakeId,
    segment_index: u.segmentIndex,
  }));
  await sb.from('unmatched_activities').insert(rows);
}
