/**
 * 업로드 파싱 경로용 복잡도 라우팅 (휴리스틱).
 * - simple: 단일 일정표 헤더 또는 짧은 문서 → 기존 단일 Phase 1
 * - catalog: 복수 `[XX]…일정표` → Map-Reduce 선분할 + 블록별 Phase 1
 * - risky: 항공편 코드 다종(2개 이상 IATA 프리픽스) 등 → 선분할은 하되 로그만 (에스컬레이션은 업로드 게이트·수동)
 */

import { countCatalogItineraryHeaders } from './catalog-pre-split';

export type UploadDocTier = 'simple' | 'catalog' | 'risky';

export interface UploadDocRouteSignal {
  tier: UploadDocTier;
  itineraryHeaderCount: number;
  /** IATA 스타일 편명에서 추정한 항공사 프리픽스 종류 수 */
  distinctFlightPrefixes: number;
  charLength: number;
}

/** 편명 후보: 2글자+IATA 숫자 또는 숫자+글자 조합 */
const FLIGHT_NO = /\b([A-Z]{2}|\d[A-Z])\d{2,4}\b/g;

export function classifyUploadDocumentComplexity(rawText: string): UploadDocRouteSignal {
  const charLength = rawText.length;
  const itineraryHeaderCount = countCatalogItineraryHeaders(rawText);

  const flightMatches = rawText.match(FLIGHT_NO) ?? [];
  const prefixes = new Set<string>();
  for (const f of flightMatches) {
    const p = f.replace(/\d+$/, '').replace(/\d/g, '');
    if (p.length >= 2) prefixes.add(p.slice(0, 2).toUpperCase());
    else if (f.length >= 2) prefixes.add(f.slice(0, 2).toUpperCase());
  }
  const distinctFlightPrefixes = prefixes.size;

  let tier: UploadDocTier = 'simple';
  if (distinctFlightPrefixes >= 2 && itineraryHeaderCount >= 1) {
    tier = 'risky';
  } else if (itineraryHeaderCount >= 2) {
    tier = 'catalog';
  } else if (charLength > 12_000 && itineraryHeaderCount === 1) {
    tier = 'catalog';
  }

  return {
    tier,
    itineraryHeaderCount,
    distinctFlightPrefixes,
    charLength,
  };
}
