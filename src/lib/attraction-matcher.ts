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
const MATCH_STOP_WORDS = new Set([
  // 도시/지역명 (2~3글자 오매칭 방지)
  '호텔', '방콕', '파타야', '부산', '청도', '보홀', '다낭', '하노이',
  '타이페이', '후쿠오카', '나가사키', '오사카', '교토', '나라', '도쿄',
  '서안', '북경', '상해', '울란바토르', '알마티', '세부', '푸켓', '발리',
  '제주', '인천', '김포', '나하', '제남', '곤명', '연길', '정주', '심천',
  '위해', '연태', '마카오', '홍콩', '광저우', '사가', '벳부', '아소',
  '도문', '용정', '양삭', '계림', '여강', '황산', '임주', '카라콜',
  // 일반 활동 키워드
  '조식', '중식', '석식', '이동', '출발', '도착', '귀환', '관광',
  '체크인', '체크아웃', '휴식', '투숙', '공항', '미팅', '가이드',
  '수속', '탑승', '호텔식', '현지식', '기내식', '한식', '자유',
  '시내', '시장', '거리', '면세점', '마사지', '온천', '쇼핑',
]);

// 비관광 활동 패턴 (매칭 시도하지 않음)
const SKIP_PATTERN = /^(호텔|리조트)?\s*(조식|투숙|체크|휴식|이동|출발|도착|귀환|수속|공항|탑승|기내|자유시간|석식|중식|면세점|쇼핑센터|가이드|미팅)/;

/**
 * 관광지 매칭 (aliases 지원)
 * 매칭 순서: exact name → aliases exact → DB name⊂activity → activity⊂DB name → aliases⊂activity → keyword split
 */
export function matchAttraction(
  activity: string,
  attractions: AttractionData[],
  destination?: string
): AttractionData | null {
  if (!attractions?.length || !activity) return null;

  // 비관광 활동은 매칭 스킵
  if (SKIP_PATTERN.test(activity)) return null;

  // destination/region 필터링
  const filtered = destination
    ? attractions.filter(a =>
        !a.region || !destination ||
        destination.includes(a.region) || (a.region && a.region.includes(destination)) ||
        (a.country && destination.includes(a.country)))
    : attractions;
  if (!filtered.length) return null;

  // 정규화 버전 (공백 제거 + 소문자: "Art Museum" ↔ "art museum" 매칭)
  const actNoSpace = activity.replace(/\s+/g, '');
  const actLower = activity.toLowerCase();
  const actLowerNoSpace = actNoSpace.toLowerCase();

  // 1. Exact name match (대소문자 무시)
  const exact = filtered.find(a => actLower === a.name.toLowerCase());
  if (exact) return exact;

  // 2. Aliases exact match (대소문자 무시)
  const aliasExact = filtered.find(a =>
    a.aliases?.some(alias => actLower === alias.toLowerCase())
  );
  if (aliasExact) return aliasExact;

  // 3. DB name ⊂ activity (name >= 2 chars, stop words 제외, 대소문자 무시)
  const dbInAct = filtered.find(a => a.name.length >= 2 && !MATCH_STOP_WORDS.has(a.name) && actLower.includes(a.name.toLowerCase()));
  if (dbInAct) return dbInAct;

  // 3-B. 공백 제거 후 DB name ⊂ activity
  const dbInActNoSpace = filtered.find(a => {
    const nameNoSpace = a.name.replace(/\s+/g, '');
    return nameNoSpace.length >= 2 && !MATCH_STOP_WORDS.has(a.name) && actLowerNoSpace.includes(nameNoSpace.toLowerCase());
  });
  if (dbInActNoSpace) return dbInActNoSpace;

  // 4. Activity ⊂ DB name (activity >= 2 chars, 대소문자 무시)
  const actInDb = filtered.find(a => activity.length >= 2 && !MATCH_STOP_WORDS.has(activity) && a.name.toLowerCase().includes(actLower));
  if (actInDb) return actInDb;

  // 4-B. 공백 제거 후 activity ⊂ DB name
  const actInDbNoSpace = filtered.find(a => {
    const nameNoSpace = a.name.replace(/\s+/g, '');
    return actNoSpace.length >= 2 && !MATCH_STOP_WORDS.has(activity) && nameNoSpace.toLowerCase().includes(actLowerNoSpace);
  });
  if (actInDbNoSpace) return actInDbNoSpace;

  // 5. Aliases ⊂ activity (alias >= 2 chars, 대소문자 무시)
  const aliasInAct = filtered.find(a =>
    a.aliases?.some(alias => alias.length >= 2 && !MATCH_STOP_WORDS.has(alias) &&
      (actLower.includes(alias.toLowerCase()) || actLowerNoSpace.includes(alias.replace(/\s+/g, '').toLowerCase())))
  );
  if (aliasInAct) return aliasInAct;

  // 6. Keyword split matching (2+ char keywords, 대소문자 무시)
  const keywordMatch = filtered.find(a => {
    const keywords = a.name.split(/[&,+/\s()（）]+/)
      .map(k => k.trim())
      .filter(k => k.length >= 2 && !MATCH_STOP_WORDS.has(k));
    return keywords.length > 0 && keywords.some(k => actLower.includes(k.toLowerCase()) || actLowerNoSpace.includes(k.toLowerCase()));
  });
  if (keywordMatch) return keywordMatch;

  return null;
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

  for (const day of days) {
    const dayMatches: { scheduleIdx: number; attraction: AttractionData }[] = [];

    day.schedule?.forEach((item, idx) => {
      if (SKIP_PATTERN.test(item.activity)) return;
      if (item.type === 'flight' || item.type === 'hotel') return;

      const attr = matchAttraction(item.activity, attractions, destination);
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
