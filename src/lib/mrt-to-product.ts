/**
 * MRT 상품 → 여소남 products 테이블 변환 유틸
 *
 * CS 필터 (여소남 브랜드 신뢰도 보호):
 *   - reviewRating >= 4.5 (MRT 리뷰 기준)
 *   - reviewCount >= 100 (통계 신뢰성)
 *   위 조건 불충족 시 converted = false 반환
 *
 * 제한:
 *   - AI 설명 생성 제외 (추후 DeepSeek V4 연동)
 *   - 이미지 URL 저장 안 함 (MRT 썸네일 저작권 — 상품 카드 내에서만)
 *   - internal_code는 API 라우트에서 DB 시퀀스 조회 후 할당
 */

import type { StayResult, ActivityResult } from '@/lib/travel-providers/types';

export interface MrtProductDraft {
  // products 테이블 필드
  display_name:          string;
  supplier_name:         string;   // '마이리얼트립'
  supplier_code:         string;   // 'MRT'
  destination:           string;   // 한국어 (예: '다낭')
  destination_code:      string;   // IATA or region code
  departure_region:      string;   // '부산' (default)
  departure_region_code: string;   // 'PUS' (default)
  duration_days:         number;
  net_price:             number;   // MRT 최저가 (마진 미포함)
  margin_rate:           number;   // 환경변수 MYREALTRIP_MARGIN_RATE
  discount_amount:       number;   // 0
  status:                'REVIEW_NEEDED';
  ai_tags:               string[];
  theme_tags:            string[];
  highlights:            string[];
  thumbnail_urls:        string[];
  internal_memo:         string;   // mrt_gid + 출처 메모
  source_filename:       string;   // 'from-mrt'
  // MRT 메타
  mrt_gid:               string;
  mrt_category:          'stay' | 'tna';
  mrt_rating?:           number;
  mrt_review_count?:     number;
  mrt_image_url?:        string;   // 저장 안 함 — 표시용만
  // 검증 결과
  cs_filter_passed:      boolean;
  cs_filter_reason?:     string;
}

const MARGIN_RATE = parseFloat(process.env.MYREALTRIP_MARGIN_RATE ?? '0.08');

// 목적지 IATA/코드 맵 (plan/route.ts와 동기화)
const DESTINATION_CODE_MAP: Record<string, string> = {
  '다낭': 'DAD', '나트랑': 'CXR', '베트남': 'DAD', '하노이': 'HAN', '호치민': 'SGN',
  '방콕': 'BKK', '태국': 'BKK', '푸켓': 'HKT', '파타야': 'BKK',
  '도쿄': 'NRT', '일본': 'NRT', '오사카': 'KIX', '후쿠오카': 'FUK',
  '나고야': 'NGO', '삿포로': 'CTS', '오키나와': 'OKA', '도야마': 'TOY',
  '싱가포르': 'SIN', '발리': 'DPS', '홍콩': 'HKG',
  '대만': 'TPE', '타이페이': 'TPE', '괌': 'GUM', '사이판': 'SPN',
  '세부': 'CEB', '필리핀': 'CEB', '코타키나발루': 'BKI',
};

const CS_MIN_RATING  = 4.5;
const CS_MIN_REVIEWS = 100;

function validateCsFilter(rating?: number, reviewCount?: number): { passed: boolean; reason?: string } {
  if (rating !== undefined && rating < CS_MIN_RATING) {
    return { passed: false, reason: `리뷰 평점 ${rating}점 < 기준 ${CS_MIN_RATING}점` };
  }
  if (reviewCount !== undefined && reviewCount < CS_MIN_REVIEWS) {
    return { passed: false, reason: `리뷰 수 ${reviewCount}건 < 기준 ${CS_MIN_REVIEWS}건` };
  }
  return { passed: true };
}

export function mrtStayToProductDraft(
  stay: StayResult,
  destination: string,
  nights = 3,
): MrtProductDraft {
  const cs = validateCsFilter(stay.rating, stay.reviewCount);
  const destCode = DESTINATION_CODE_MAP[destination] ?? destination.toUpperCase().slice(0, 3);

  const highlights: string[] = [];
  if (stay.rating) highlights.push(`마이리얼트립 평점 ${stay.rating.toFixed(1)}점`);
  if (stay.reviewCount) highlights.push(`리뷰 ${stay.reviewCount.toLocaleString()}건`);
  if (stay.location) highlights.push(stay.location);
  if (stay.amenities?.length) highlights.push(...stay.amenities.slice(0, 2));

  return {
    display_name:          stay.name || `${destination} 호텔`,
    supplier_name:         '마이리얼트립',
    supplier_code:         'MRT',
    destination,
    destination_code:      destCode,
    departure_region:      '부산',
    departure_region_code: 'PUS',
    duration_days:         nights + 1,
    net_price:             (stay.pricePerNight ?? 0) * nights,
    margin_rate:           MARGIN_RATE,
    discount_amount:       0,
    status:                'REVIEW_NEEDED',
    ai_tags:               ['mrt', 'stay', destination.toLowerCase()],
    theme_tags:            [],
    highlights,
    thumbnail_urls:        [],
    internal_memo:         `[MRT 호텔] gid:${stay.providerId} | ${stay.providerUrl}`,
    source_filename:       'from-mrt',
    mrt_gid:               stay.providerId,
    mrt_category:          'stay',
    mrt_rating:            stay.rating,
    mrt_review_count:      stay.reviewCount,
    mrt_image_url:         stay.imageUrl,
    cs_filter_passed:      cs.passed,
    cs_filter_reason:      cs.reason,
  };
}

export function mrtTnaToProductDraft(
  tna: ActivityResult,
  destination: string,
): MrtProductDraft {
  const cs = validateCsFilter(tna.rating, tna.reviewCount);
  const destCode = DESTINATION_CODE_MAP[destination] ?? destination.toUpperCase().slice(0, 3);

  const highlights: string[] = [];
  if (tna.rating) highlights.push(`마이리얼트립 평점 ${tna.rating.toFixed(1)}점`);
  if (tna.reviewCount) highlights.push(`리뷰 ${tna.reviewCount.toLocaleString()}건`);
  if (tna.duration) highlights.push(`소요 ${tna.duration}`);
  if (tna.category) highlights.push(tna.category);

  return {
    display_name:          tna.name || `${destination} 투어`,
    supplier_name:         '마이리얼트립',
    supplier_code:         'MRT',
    destination,
    destination_code:      destCode,
    departure_region:      '부산',
    departure_region_code: 'PUS',
    duration_days:         1,
    net_price:             tna.price ?? 0,
    margin_rate:           MARGIN_RATE,
    discount_amount:       0,
    status:                'REVIEW_NEEDED',
    ai_tags:               ['mrt', 'tna', destination.toLowerCase(), tna.category ?? 'tour'].filter(Boolean),
    theme_tags:            [],
    highlights,
    thumbnail_urls:        [],
    internal_memo:         `[MRT 투어] gid:${tna.providerId} | ${tna.providerUrl}`,
    source_filename:       'from-mrt',
    mrt_gid:               tna.providerId,
    mrt_category:          'tna',
    mrt_rating:            tna.rating,
    mrt_review_count:      tna.reviewCount,
    mrt_image_url:         tna.imageUrl,
    cs_filter_passed:      cs.passed,
    cs_filter_reason:      cs.reason,
  };
}
