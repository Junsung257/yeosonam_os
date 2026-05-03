/**
 * 고객 패키지 목록 출발 허브 — URL ?hub= 와 departure_airport 매핑.
 * 기본 hub=busan(부산·김해 공항 표기 데이터 포함); 전국은 hub=all.
 */

export type DepartureHubId = 'busan' | 'incheon' | 'daegu' | 'cheongju' | 'all';

export const DEFAULT_DEPARTURE_HUB: DepartureHubId = 'busan';

/** UI 노출용 — 라벨은 도시명만(부산 허브는 김해공항 출발 데이터까지 동일 필터) */
export const DEPARTURE_HUB_OPTIONS: { id: DepartureHubId; label: string; short: string }[] = [
  { id: 'busan', label: '부산', short: '부산' },
  { id: 'incheon', label: '인천', short: '인천' },
  { id: 'daegu', label: '대구', short: '대구' },
  { id: 'cheongju', label: '청주', short: '청주' },
  { id: 'all', label: '전국', short: '전국' },
];

const HUB_ALIASES: Record<string, DepartureHubId> = {
  busan: 'busan',
  pus: 'busan',
  gimhae: 'busan',
  incheon: 'incheon',
  icn: 'incheon',
  daegu: 'daegu',
  tae: 'daegu',
  cheongju: 'cheongju',
  cjj: 'cheongju',
  all: 'all',
  nationwide: 'all',
  any: 'all',
};

export function normalizeDepartureHub(raw: string | undefined | null): DepartureHubId {
  if (raw == null || String(raw).trim() === '') return DEFAULT_DEPARTURE_HUB;
  const key = String(raw).trim().toLowerCase();
  return HUB_ALIASES[key] ?? DEFAULT_DEPARTURE_HUB;
}

/** JS-side 필터(마감특가 등 SQL or 와 병행 시) */
export function hubMatchesDepartureAirport(hub: DepartureHubId, raw: string | null | undefined): boolean {
  if (hub === 'all') return true;
  const a = (raw || '').trim();
  if (hub === 'busan') {
    if (!a) return true;
    return /김해|부산|gimhae|pus/i.test(a);
  }
  if (hub === 'incheon') return /인천|icn/i.test(a);
  if (hub === 'daegu') return /대구|tae/i.test(a);
  if (hub === 'cheongju') return /청주|cjj/i.test(a);
  return true;
}

/**
 * Supabase .or() 한 번에 넣을 문자열. null 이면 출발 허브 제한 없음.
 * 값은 DB에 흔한 표기(부산(김해), 김해공항 등)를 ilike 로 포괄.
 */
export function departureHubSupabaseOr(hub: DepartureHubId): string | null {
  if (hub === 'all') return null;
  if (hub === 'busan') {
    return [
      'departure_airport.is.null',
      'departure_airport.ilike.%김해%',
      'departure_airport.ilike.%부산%',
      'departure_airport.ilike.%gimhae%',
      'departure_airport.ilike.%PUS%',
    ].join(',');
  }
  if (hub === 'incheon') {
    return ['departure_airport.ilike.%인천%', 'departure_airport.ilike.%ICN%'].join(',');
  }
  if (hub === 'daegu') {
    return ['departure_airport.ilike.%대구%', 'departure_airport.ilike.%TAE%'].join(',');
  }
  if (hub === 'cheongju') {
    return ['departure_airport.ilike.%청주%', 'departure_airport.ilike.%CJJ%'].join(',');
  }
  return null;
}

/** 검색·링크용 쿼리스트링에 hub 반영 (기본 부산은 생략) */
export function appendDepartureHubToSearchParams(params: URLSearchParams, hub: DepartureHubId) {
  if (hub === 'all') params.set('hub', 'all');
  else if (hub !== DEFAULT_DEPARTURE_HUB) params.set('hub', hub);
  else params.delete('hub');
}
