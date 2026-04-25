/**
 * 관광지 매칭 공통 모듈
 * - A4 템플릿 + 랜딩페이지 공통 사용
 * - aliases 매칭 지원
 * - 미매칭 항목 수집 기능
 */

export interface AttractionData {
  id?: string;
  name: string;
  short_desc?: string | null;
  long_desc?: string | null;
  badge_type?: string;
  emoji?: string | null;
  country?: string | null;
  region?: string | null;
  category?: string | null;
  aliases?: string[];
  photos?: { src_medium: string; src_large: string; photographer: string; pexels_id: number }[];
}

// 매칭 제외 키워드 (일반 이동/휴식 활동)
// ⚠️ 키워드 추가 시 ERR-LB-DAD-keyword-spillover 같은 단어 단독 매칭 사고 방지가 핵심.
//    "호이안 바구니배" 같은 '도시명+활동' 어트랙션이 도시명 키워드만으로 모든 activity에 매칭되는 사고가
//    2026-04-20 LB-DAD-05-01에서 발생 — 호이안 야경/못주스 등 모든 호이안 activity에 "호이안 바구니배"가 잘못 붙음.
const MATCH_STOP_WORDS = new Set([
  // 도시/지역명 (2~3글자 오매칭 방지)
  '호텔', '방콕', '파타야', '부산', '청도', '보홀', '다낭', '하노이', '호이안', '후에',
  '타이페이', '후쿠오카', '나가사키', '오사카', '교토', '나라', '도쿄',
  '서안', '북경', '상해', '울란바토르', '알마티', '세부', '푸켓', '발리',
  '제주', '인천', '김포', '나하', '제남', '곤명', '연길', '정주', '심천',
  '위해', '연태', '마카오', '홍콩', '광저우', '사가', '벳부', '아소',
  '도문', '용정', '양삭', '계림', '여강', '황산', '임주', '카라콜',
  '나트랑', '달랏', '판랑', '캄란', '푸꾸옥', '하롱', '닌빈', '치앙마이',
  '방비엥', '비엔티엔', '루앙프라방', '쿠알라', '말라카', '겐팅',
  // 일반 활동 키워드
  '조식', '중식', '석식', '이동', '출발', '도착', '귀환', '관광',
  '체크인', '체크아웃', '휴식', '투숙', '공항', '미팅', '가이드',
  '수속', '탑승', '호텔식', '현지식', '기내식', '한식', '자유',
  '시내', '시장', '거리', '면세점', '마사지', '온천', '쇼핑',
  // ERR-20260418-28 — 일반 장소 키워드 (오매칭 방지)
  '공원', '사원', '교회', '성당', '광장', '박물관', '궁전', '탑',
  '섬', '해변', '호수', '다리', '거리', '야시장', '동굴', '산',
  '전망대', '분수', '정원', '폭포',
  // ERR-20260418-31 — 지역/도시명 + 관광단지명 키워드 (오매칭 방지)
  '말라카', '싱가포르', '쿠알라', '쿠알라룸푸르', '겐팅', '조호바루',
  '타이베이', '타이페이', '대만', '베트남', '말레이시아', '태국', '중국',
  '일본', '필리핀', '인도네시아', '호주', '몽골', '라오스',
  '센토사', '페트로나스', '가든스', 'KLCC', '마리나베이', '마리나',
  '차이나타운', '야류', '지우펀', '스펀',
]);

// 비관광 활동 패턴 (매칭 시도하지 않음)
const SKIP_PATTERN = /^(호텔|리조트)?\s*(조식|투숙|체크|휴식|이동|출발|도착|귀환|수속|공항|탑승|기내|자유시간|석식|중식|면세점|쇼핑센터|가이드|미팅)/;

// ═══════════════════════════════════════════════════════════════════════════
//  성능 최적화: 인덱스 기반 매칭
// ═══════════════════════════════════════════════════════════════════════════

/**
 * AttractionIndex — destination 필터 + 룩업 맵 사전 구축
 * 한 렌더/한 요청 안에서 여러 activity를 매칭할 때 반복 필터/정렬 비용 제거.
 */
export interface AttractionIndex {
  filtered: AttractionData[];                   // destination 필터 통과한 후보
  byLowerName: Map<string, AttractionData>;     // 대소문자 무시 정확 이름 → 즉시 룩업
  byLowerAlias: Map<string, AttractionData>;    // 별칭 정확 룩업
  substringList: AttractionData[];              // 이름 길이 DESC 정렬 (긴 이름 우선 매칭)
}

export function buildAttractionIndex(
  attractions: AttractionData[],
  destination?: string,
): AttractionIndex {
  const filtered = destination
    ? attractions.filter(a =>
        !a.region || !destination ||
        destination.includes(a.region) || (a.region && a.region.includes(destination)) ||
        (a.country && destination.includes(a.country)))
    : attractions;

  const byLowerName = new Map<string, AttractionData>();
  const byLowerAlias = new Map<string, AttractionData>();
  for (const a of filtered) {
    if (a.name) byLowerName.set(a.name.toLowerCase(), a);
    if (a.aliases) {
      for (const al of a.aliases) {
        if (al) byLowerAlias.set(al.toLowerCase(), a);
      }
    }
  }
  // 긴 이름이 짧은 이름보다 먼저 매칭되도록 정렬 (예: "메르데카 광장" > "광장")
  const substringList = filtered.slice().sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));

  return { filtered, byLowerName, byLowerAlias, substringList };
}

/**
 * 인덱스 기반 관광지 매칭 (matchAttraction의 O(1) 룩업 버전)
 * 매칭 순서는 기존과 동일 — 호환성 100% 유지.
 */
export function matchAttractionIndexed(
  activity: string,
  index: AttractionIndex,
): AttractionData | null {
  if (!activity || !index.filtered.length) return null;
  if (SKIP_PATTERN.test(activity)) return null;

  const actLower = activity.toLowerCase();
  const actNoSpace = activity.replace(/\s+/g, '');
  const actLowerNoSpace = actNoSpace.toLowerCase();

  // 1. Exact name (O(1))
  const exact = index.byLowerName.get(actLower);
  if (exact) return exact;

  // 2. Alias exact (O(1))
  const aliasExact = index.byLowerAlias.get(actLower);
  if (aliasExact) return aliasExact;

  // 3+4. 긴 이름부터 양방향 substring (조기 반환으로 실측 O(log N) 수준)
  for (const a of index.substringList) {
    if (!a.name || a.name.length < 2 || MATCH_STOP_WORDS.has(a.name)) continue;
    const nameLower = a.name.toLowerCase();
    const nameNoSpace = nameLower.replace(/\s+/g, '');
    // DB name ⊂ activity
    if (actLower.includes(nameLower)) return a;
    if (nameNoSpace.length >= 2 && actLowerNoSpace.includes(nameNoSpace)) return a;
    // activity ⊂ DB name
    if (activity.length >= 2 && !MATCH_STOP_WORDS.has(activity) && nameLower.includes(actLower)) return a;
    if (actNoSpace.length >= 2 && !MATCH_STOP_WORDS.has(activity) && nameNoSpace.includes(actLowerNoSpace)) return a;
  }

  // 5. Aliases ⊂ activity
  for (const a of index.filtered) {
    if (!a.aliases) continue;
    for (const alias of a.aliases) {
      if (!alias || alias.length < 2 || MATCH_STOP_WORDS.has(alias)) continue;
      const aliasLower = alias.toLowerCase();
      const aliasNoSpace = alias.replace(/\s+/g, '').toLowerCase();
      if (actLower.includes(aliasLower) || actLowerNoSpace.includes(aliasNoSpace)) return a;
    }
  }

  // 6. Keyword split
  for (const a of index.filtered) {
    if (!a.name) continue;
    const keywords = a.name.split(/[&,+/\s()（）]+/)
      .map(k => k.trim())
      .filter(k => k.length >= 2 && !MATCH_STOP_WORDS.has(k));
    for (const k of keywords) {
      const kLower = k.toLowerCase();
      if (actLower.includes(kLower) || actLowerNoSpace.includes(kLower)) return a;
    }
  }

  return null;
}

// ── 렌더/요청 스코프 인덱스 캐시 (WeakMap) ──────────────────────────────────
// 같은 attractions 배열을 여러 번 매칭할 때 자동으로 인덱스 재사용.
// destination이 다르면 다른 캐시 엔트리 사용.
const indexCache = new WeakMap<AttractionData[], Map<string, AttractionIndex>>();

function getOrBuildIndex(attractions: AttractionData[], destination?: string): AttractionIndex {
  let destMap = indexCache.get(attractions);
  if (!destMap) {
    destMap = new Map();
    indexCache.set(attractions, destMap);
  }
  const key = destination || '__no_dest__';
  let idx = destMap.get(key);
  if (!idx) {
    idx = buildAttractionIndex(attractions, destination);
    destMap.set(key, idx);
  }
  return idx;
}

/**
 * 관광지 매칭 (aliases 지원)
 * 매칭 순서: exact name → aliases exact → DB name⊂activity → activity⊂DB name → aliases⊂activity → keyword split
 *
 * 성능: WeakMap 캐시로 같은 attractions 배열 반복 호출 시 인덱스 재사용 (O(N) → O(log N) 실측).
 */
export function matchAttraction(
  activity: string,
  attractions: AttractionData[],
  destination?: string,
): AttractionData | null {
  if (!attractions?.length || !activity) return null;
  if (SKIP_PATTERN.test(activity)) return null;
  const index = getOrBuildIndex(attractions, destination);
  return matchAttractionIndexed(activity, index);
}

/**
 * 한 activity 문자열에서 여러 관광지 매칭 (콤마 분리 + 개별 매칭)
 * 기존 데이터의 "▶오타루운하, 키타이치가라스, 오르골당" 같은 콤마 묶음 대응
 * 기존 matchAttraction()과 하위 호환: 매칭이 없으면 빈 배열.
 */
export function matchAttractions(
  activity: string,
  attractions: AttractionData[],
  destination?: string
): AttractionData[] {
  if (!attractions?.length || !activity) return [];
  if (SKIP_PATTERN.test(activity)) return [];

  // 동일 attractions/destination에 대해 한 번만 인덱스 빌드
  const index = getOrBuildIndex(attractions, destination);

  // 1) 전체 문자열로 단일 매칭 시도
  const single = matchAttractionIndexed(activity, index);
  if (single) {
    if (!activity.includes(',') && !activity.includes('，')) return [single];
  }

  // 2) 콤마 분리 후 개별 매칭
  const body = activity.startsWith('▶') ? activity.slice(1).trim() : activity;
  const withoutParen = body.replace(/\s*\([^)]*\)\s*$/, '');
  const parts = withoutParen.split(/[,，]\s*/);
  if (parts.length <= 1) return single ? [single] : [];

  const results: AttractionData[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length < 2) continue;
    const match = matchAttractionIndexed(trimmed, index);
    if (match && !seen.has(match.name)) {
      seen.add(match.name);
      results.push(match);
    }
  }
  return results.length > 0 ? results : (single ? [single] : []);
}

/**
 * 일정 전체에서 매칭/미매칭 분류
 */
export interface MatchResult {
  matched: Map<number, { scheduleIdx: number; attraction: AttractionData }[]>;
  unmatched: { activity: string; dayNumber: number }[];
}

export function matchAllActivities(
  days: { day: number; schedule?: { activity: string; type?: string }[] }[],
  attractions: AttractionData[],
  destination?: string
): MatchResult {
  const matched = new Map<number, { scheduleIdx: number; attraction: AttractionData }[]>();
  const unmatched: { activity: string; dayNumber: number }[] = [];

  // 한 번만 인덱스 빌드 → 전체 루프에서 재사용
  const index = getOrBuildIndex(attractions, destination);

  for (const day of days) {
    const dayMatches: { scheduleIdx: number; attraction: AttractionData }[] = [];

    day.schedule?.forEach((item, idx) => {
      if (SKIP_PATTERN.test(item.activity)) return;
      if (item.type === 'flight' || item.type === 'hotel') return;

      const attr = matchAttractionIndexed(item.activity, index);
      if (attr) {
        dayMatches.push({ scheduleIdx: idx, attraction: attr });
      } else {
        unmatched.push({ activity: item.activity, dayNumber: day.day });
      }
    });

    if (dayMatches.length > 0) {
      matched.set(day.day, dayMatches);
    }
  }

  return { matched, unmatched };
}

/**
 * itinerary_data 듀얼 포맷 정규화 헬퍼
 * DB에 { days: [...] } 객체 또는 [...] 배열이 혼재 → 항상 배열 반환
 */
export function normalizeDays<T = Record<string, unknown>>(
  itineraryData: T[] | { days?: T[] } | null | undefined,
): T[] {
  if (!itineraryData) return [];
  if (Array.isArray(itineraryData)) return itineraryData;
  return (itineraryData as { days?: T[] }).days || [];
}
