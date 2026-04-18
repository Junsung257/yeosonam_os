/**
 * @file package-acl.ts
 * @description Anti-Corruption Layer — 레거시 DB 레코드를 정규 스키마로 변환.
 *
 * 목적:
 * - 운영 중 상품 데이터는 다양한 시점에 저장되어 포맷이 혼재 (photos 구형/신형 등)
 * - 렌더러/검증기는 정규 포맷만 받아야 버그 제로
 * - 이 레이어가 DB ↔ 비즈니스 로직 사이 "번역기" 역할
 *
 * 사용처:
 * - 모바일/A4 렌더러가 pkg 받기 전에 normalize 한 번
 * - Zod validation 전에 normalize 한 번
 * - 마이그레이션 CLI가 bulk-normalize 할 때
 */

import { formatDepartureDays } from './admin-utils';
import type { PackageCore } from './package-schema';

// ═══════════════════════════════════════════════════════════════════════════
//  Photo 정규화 — 구형식 {url,thumb,credit} → 신형식 {src_medium,src_large,photographer}
// ═══════════════════════════════════════════════════════════════════════════

interface LegacyPhoto { url?: string; thumb?: string; credit?: string; pexels_id?: number; alt?: string }
interface NewPhoto { src_medium: string; src_large: string; photographer: string; pexels_id: number; alt?: string }

export function normalizePhoto(photo: unknown, fallbackAlt = ''): NewPhoto | null {
  if (!photo || typeof photo !== 'object') return null;
  const p = photo as LegacyPhoto & Partial<NewPhoto>;
  // 이미 신형식
  if (typeof p.src_medium === 'string' && typeof p.src_large === 'string') {
    return {
      src_medium: p.src_medium,
      src_large: p.src_large,
      photographer: p.photographer || p.credit || '',
      pexels_id: p.pexels_id || 0,
      alt: p.alt || fallbackAlt,
    };
  }
  // 구형식 → 신형식 변환
  if (typeof p.url === 'string' || typeof p.thumb === 'string') {
    return {
      src_medium: p.thumb || p.url || '',
      src_large: p.url || p.thumb || '',
      photographer: p.credit || p.photographer || '',
      pexels_id: p.pexels_id || 0,
      alt: p.alt || fallbackAlt,
    };
  }
  return null;
}

export function normalizePhotos(photos: unknown, fallbackAlt = ''): NewPhoto[] {
  if (!Array.isArray(photos)) return [];
  return photos
    .map(p => normalizePhoto(p, fallbackAlt))
    .filter((p): p is NewPhoto => p !== null);
}

// ═══════════════════════════════════════════════════════════════════════════
//  OptionalTour 정규화 — region 추론 + price 통일
// ═══════════════════════════════════════════════════════════════════════════

const REGION_INFERENCE: Record<string, string> = {
  '말레이시아': '말레이시아', '쿠알라': '말레이시아', '말라카': '말레이시아', '겐팅': '말레이시아',
  '싱가포르': '싱가포르',
  '태국': '태국', '방콕': '태국', '파타야': '태국', '푸켓': '태국',
  '베트남': '베트남', '다낭': '베트남', '하노이': '베트남', '나트랑': '베트남',
  '대만': '대만', '타이페이': '대만', '타이베이': '대만',
  '일본': '일본', '후쿠오카': '일본', '오사카': '일본', '홋카이도': '일본',
  '중국': '중국', '서안': '중국', '북경': '중국', '상해': '중국', '장가계': '중국', '칭다오': '중국',
  '라오스': '라오스', '몽골': '몽골',
  '필리핀': '필리핀', '보홀': '필리핀', '세부': '필리핀',
  '인도네시아': '인도네시아', '발리': '인도네시아',
};

function inferRegion(name: string, explicit?: string | null): string | null {
  if (explicit && explicit.trim()) return explicit.trim();
  if (!name) return null;
  // 괄호 내 키워드 우선
  const paren = name.match(/\(([^)]+)\)/);
  if (paren) {
    for (const [kw, region] of Object.entries(REGION_INFERENCE)) {
      if (paren[1].includes(kw)) return region;
    }
  }
  // 본문 키워드
  for (const [kw, region] of Object.entries(REGION_INFERENCE)) {
    if (name.includes(kw)) return region;
  }
  return null;
}

interface LegacyTour {
  name?: string; region?: string | null;
  price?: string | number; price_usd?: number; price_krw?: number;
  note?: string | null; day?: number;
}

export function normalizeOptionalTour(raw: unknown): PackageCore['optional_tours'][number] | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as LegacyTour;
  if (!t.name) return null;
  const inferred = inferRegion(t.name, t.region);
  return {
    name: t.name,
    region: (inferred as PackageCore['optional_tours'][number]['region']) || null,
    price: typeof t.price === 'string' ? t.price : (t.price != null ? String(t.price) : null),
    price_usd: typeof t.price_usd === 'number' ? t.price_usd : null,
    price_krw: typeof t.price_krw === 'number' ? t.price_krw : null,
    note: t.note || null,
    day: typeof t.day === 'number' ? t.day : null,
  };
}

export function normalizeOptionalTours(raw: unknown): PackageCore['optional_tours'] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeOptionalTour)
    .filter((t): t is PackageCore['optional_tours'][number] => t !== null);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Itinerary data 정규화 — DaySchedule[] | { days: [...] } → 배열 통일
// ═══════════════════════════════════════════════════════════════════════════

export function normalizeItineraryData(raw: unknown): PackageCore['itinerary_data'] {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw as PackageCore['itinerary_data'];
  if (typeof raw === 'object' && 'days' in (raw as Record<string, unknown>)) {
    const days = (raw as { days?: unknown }).days;
    return Array.isArray(days) ? (days as PackageCore['itinerary_data']) : null;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  전체 Package 정규화 (DB → 렌더러/검증기)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 레거시 DB 레코드를 정규 Package로 변환.
 * **모든 렌더러/검증기는 이 함수의 출력만 소비**해야 함.
 *
 * - photos (attractions 내부): 호출자가 normalizePhotos 별도 호출
 * - optional_tours: 자동 region 추론
 * - departure_days: JSON → 평문
 * - itinerary_data: 객체/배열 포맷 통일
 */
export function normalizePackage(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    departure_days: formatDepartureDays(raw.departure_days) || null,
    optional_tours: normalizeOptionalTours(raw.optional_tours),
    itinerary_data: normalizeItineraryData(raw.itinerary_data),
    // 기본값 보정
    price_tiers: Array.isArray(raw.price_tiers) ? raw.price_tiers : [],
    price_dates: Array.isArray(raw.price_dates) ? raw.price_dates : [],
    excluded_dates: Array.isArray(raw.excluded_dates) ? raw.excluded_dates : [],
    confirmed_dates: Array.isArray(raw.confirmed_dates) ? raw.confirmed_dates : [],
    inclusions: Array.isArray(raw.inclusions) ? raw.inclusions : [],
    excludes: Array.isArray(raw.excludes) ? raw.excludes : [],
    surcharges: Array.isArray(raw.surcharges) ? raw.surcharges : [],
    notices_parsed: Array.isArray(raw.notices_parsed) ? raw.notices_parsed : [],
    product_highlights: Array.isArray(raw.product_highlights) ? raw.product_highlights : [],
  };
}

/**
 * Attraction 레코드 정규화 (photos 포함)
 */
export function normalizeAttraction<T extends { name?: string; photos?: unknown }>(raw: T): T & { photos: NewPhoto[] } {
  return {
    ...raw,
    photos: normalizePhotos(raw.photos, raw.name || ''),
  };
}
