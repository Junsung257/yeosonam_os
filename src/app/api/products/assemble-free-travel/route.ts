/**
 * POST /api/products/assemble-free-travel
 *
 * MRT 호텔 + 투어 + (선택) 항공을 묶어 반자유여행 상품으로 조립·등록.
 * 어드민 /admin/products/assemble-free-travel 에서 호출.
 *
 * CS 필터 강제: hotel.rating >= 4.5, reviewCount >= 100
 * 각 activity도 동일 필터 적용.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { buildMylinkUrl } from '@/lib/travel-providers/mrt';
import type { StayResult, ActivityResult, FlightResult } from '@/lib/travel-providers/types';

export const maxDuration = 30;

const CS_MIN_RATING  = 4.5;
const CS_MIN_REVIEWS = 100;

const DESTINATION_CODE_MAP: Record<string, string> = {
  '다낭': 'DAD', '나트랑': 'CXR', '베트남': 'DAD', '하노이': 'HAN', '호치민': 'SGN',
  '방콕': 'BKK', '태국': 'BKK', '푸켓': 'HKT', '파타야': 'BKK',
  '도쿄': 'NRT', '일본': 'NRT', '오사카': 'KIX', '후쿠오카': 'FUK',
  '나고야': 'NGO', '삿포로': 'CTS', '오키나와': 'OKA',
  '싱가포르': 'SIN', '발리': 'DPS', '홍콩': 'HKG',
  '대만': 'TPE', '타이페이': 'TPE', '괌': 'GUM', '사이판': 'SPN',
  '세부': 'CEB', '필리핀': 'CEB', '코타키나발루': 'BKI',
};

function validateCs(item: StayResult | ActivityResult): string | null {
  const rating = item.rating;
  const count  = item.reviewCount;
  if (rating !== undefined && rating < CS_MIN_RATING)  return `평점 ${rating} < ${CS_MIN_RATING}`;
  if (count  !== undefined && count  < CS_MIN_REVIEWS) return `리뷰 ${count}건 < ${CS_MIN_REVIEWS}`;
  return null;
}

async function getNextInternalCode(
  departureCode: string,
  supplierCode: string,
  destinationCode: string,
  durationDays: number,
): Promise<string> {
  const prefix =
    departureCode.toUpperCase()
    + '-' + supplierCode.toUpperCase()
    + '-' + destinationCode.toUpperCase()
    + '-' + String(durationDays).padStart(2, '0')
    + '-';

  const { data } = await supabaseAdmin
    .from('products')
    .select('internal_code')
    .like('internal_code', `${prefix}%`)
    .order('internal_code', { ascending: false })
    .limit(1);

  let lastSeq = 0;
  if (data && data.length > 0) {
    const seqStr = (data[0] as { internal_code: string }).internal_code.slice(prefix.length);
    const parsed = parseInt(seqStr, 10);
    if (!isNaN(parsed)) lastSeq = parsed;
  }
  return prefix + String(lastSeq + 1).padStart(4, '0');
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json() as {
      destination: string;
      nights:      number;
      adults:      number;
      children?:   number;
      dateFrom:    string;
      dateTo:      string;
      hotel:       StayResult;
      activities:  ActivityResult[];
      flight?:     FlightResult;
      margin?:     number; // % 추가 마진
    };

    const { destination, nights, adults, dateFrom, dateTo, hotel, activities, flight, margin = 10 } = body;

    if (!destination || !hotel || !activities?.length) {
      return NextResponse.json({ error: 'destination, hotel, activities 필수' }, { status: 400 });
    }

    // CS 필터 강제
    const hotelErr = validateCs(hotel);
    if (hotelErr) return NextResponse.json({ error: `호텔 CS 필터 미통과: ${hotelErr}` }, { status: 400 });

    for (const act of activities) {
      const actErr = validateCs(act);
      if (actErr) return NextResponse.json({ error: `투어 CS 필터 미통과 (${act.name}): ${actErr}` }, { status: 400 });
    }

    // 가격 계산
    const hotelTotal      = (hotel.pricePerNight ?? 0) * nights * adults;
    const activitiesTotal = activities.reduce((s, a) => s + (a.price ?? 0) * adults, 0);
    const flightTotal     = flight ? (flight.price ?? 0) * adults : 0;
    const basePrice       = hotelTotal + activitiesTotal + flightTotal;
    const netPrice        = Math.ceil(basePrice / 1000) * 1000;
    const marginRate      = margin / 100;

    // 어필리에이트 링크 빌드
    const sessionRef = `assemble-${destination}-${Date.now()}`;
    const hotelLink  = buildMylinkUrl(hotel.providerUrl ?? '', sessionRef);
    const actLinks   = activities.map(a => buildMylinkUrl(a.providerUrl ?? '', sessionRef));

    // 상품명 자동 생성
    const nightsStr    = `${nights}박${nights + 1}일`;
    const actNames     = activities.map(a => a.name).slice(0, 2).join('+');
    const displayName  = `[반자유여행] ${destination} ${nightsStr} (${actNames})`;

    // inclusions 생성
    const inclusions = [
      `항공 (${flight?.airline ?? '미포함'})`,
      `호텔 ${nights}박 — ${hotel.name}`,
      ...activities.map(a => `${a.name}${a.duration ? ` (${a.duration})` : ''}`),
    ];

    // itinerary 조립
    const itineraryDays = Array.from({ length: nights + 1 }, (_, i) => ({
      day:        i + 1,
      title:      i === 0 ? `${destination} 도착` : i === nights ? '귀국' : `Day ${i + 1}`,
      activities: i === 0 && flight
        ? [{ activity: `${flight.airline} ${flight.flightCode ?? ''} 탑승`, type: 'transport' as const }]
        : activities.slice(0, 2).map(a => ({ activity: a.name, type: 'sightseeing' as const })),
    }));

    // MRT 링크 목록 (내부 참조용)
    const mrtLinks = [
      `호텔: ${hotelLink}`,
      ...actLinks.map((l, i) => `투어${i + 1}: ${l}`),
      flight ? `항공: ${flight.providerUrl ?? ''}` : null,
    ].filter(Boolean).join('\n');

    // internal_memo: 조립 메타 + 링크 + 일정
    const internalMemo = JSON.stringify({
      type:            'assemble',
      mrt_hotel:       hotel.providerId,
      mrt_activities:  activities.map(a => a.providerId),
      mrt_flight:      flight?.providerId ?? null,
      inclusions,
      itinerary:       itineraryDays,
      mrt_links:       mrtLinks,
      adults,
      children:        body.children ?? 0,
      dateFrom,
      dateTo,
    });

    const destCode     = DESTINATION_CODE_MAP[destination] ?? destination.toUpperCase().slice(0, 3);
    const internalCode = await getNextInternalCode('PUS', 'MRT', destCode, nights + 1);

    const insertData = {
      internal_code:          internalCode,
      display_name:           displayName,
      supplier_name:          '마이리얼트립',
      supplier_code:          'MRT',
      destination,
      destination_code:       destCode,
      departure_region:       '부산',
      departure_region_code:  'PUS',
      duration_days:          nights + 1,
      net_price:              netPrice,
      margin_rate:            marginRate,
      discount_amount:        0,
      status:                 'REVIEW_NEEDED',
      ai_tags:                ['semi_free', 'assemble', 'mrt', destination.toLowerCase()],
      theme_tags:             [] as string[],
      highlights:             inclusions.slice(0, 5),
      thumbnail_urls:         [] as string[],
      internal_memo:          internalMemo,
      source_filename:        'assemble-free-travel',
    };

    const { data: pkg, error } = await supabaseAdmin
      .from('products')
      .insert(insertData)
      .select('internal_code, display_name, status')
      .single();

    if (error) throw error;

    return NextResponse.json({
      ok:              true,
      product:         pkg,
      price_breakdown: {
        hotel:      hotelTotal,
        activities: activitiesTotal,
        flight:     flightTotal,
        base:       basePrice,
        margin_pct: margin,
        net_price:  netPrice,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조립 실패' },
      { status: 500 },
    );
  }
}
