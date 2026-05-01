/**
 * Keyword Research — 실제 검색 트렌드/볼륨 수집 + tier 분류
 *
 * 책임:
 *   1) Google Trends Daily Trends RSS (Geo=KR) → 해외여행 관련 키워드 추출
 *   2) Naver DataLab 검색어 트렌드 API (env 키 있을 때만) → 월간 추이
 *   3) Naver News RSS — 여행/관광 카테고리 헤드라인 → 시의성 토픽
 *   4) keyword tier 분류 (head/mid/longtail) — 어절수 + 검색량 + 우리 destination 매칭
 *
 * 모두 외부 키 없으면 graceful fallback (RSS는 키 불필요).
 *
 * 캐시: keyword_research_cache 테이블 24h TTL
 */

import { supabaseAdmin } from './supabase';

// ── 타입 ──────────────────────────────────────────────────

export type KeywordTier = 'head' | 'mid' | 'longtail';
export type CompetitionLevel = 'low' | 'medium' | 'high';

export interface TrendKeyword {
  keyword: string;
  source: 'google_trends' | 'naver_datalab' | 'naver_news';
  related_destination?: string | null;
  trend_score?: number;        // 0~100
  search_volume?: number;       // 추정 월간
  competition_level?: CompetitionLevel;
  raw?: Record<string, unknown>;
}

export interface KeywordResearchResult {
  keyword: string;
  monthly_search_volume: number | null;
  competition_level: CompetitionLevel | null;
  tier: KeywordTier;
  related_queries: string[];
  source: string;
  cached: boolean;
}

// ── 우리 카탈로그 (destination 매칭용) ─────────────────────

const KNOWN_DESTINATIONS = [
  '다낭', '호이안', '나트랑', '달랏', '푸꾸옥', '하노이', '하롱베이', '호찌민',
  '방콕', '파타야', '치앙마이', '푸켓',
  '발리', '세부', '보홀', '보라카이',
  '오사카', '교토', '도쿄', '하코네', '후쿠오카', '유후인', '삿포로', '북해도',
  '싱가포르', '마카오', '홍콩',
  '장가계', '청도', '칭다오', '서안', '시안', '상하이', '베이징',
  '괌', '사이판', '연길', '백두산',
  '라오스', '루앙프라방', '방비엥',
];

export function detectDestination(text: string): string | null {
  for (const d of KNOWN_DESTINATIONS) {
    if (text.includes(d)) return d;
  }
  return null;
}

// 한국 여행자가 자주 쓰는 의도어
const TRAVEL_INTENT_WORDS = [
  '여행', '패키지', '투어', '항공권', '숙소', '호텔', '리조트',
  '비자', '환전', '날씨', '준비물', '맛집', '관광', '명소',
  '자유여행', '신혼여행', '효도여행', '가족여행', '졸업여행',
  '특가', '저렴', '추천', '코스', '일정', '비용',
];

export function isTravelRelated(text: string): boolean {
  const lower = text.toLowerCase();
  return TRAVEL_INTENT_WORDS.some(w => lower.includes(w))
    || KNOWN_DESTINATIONS.some(d => text.includes(d));
}

// ── tier 분류 ──────────────────────────────────────────────

/**
 * 키워드 tier 결정 규칙:
 *   head     — 1~2어절 + (destination 단독 OR core travel term)
 *   mid      — 3~4어절 + 의도어 1개
 *   longtail — 5어절 이상 OR 출발지/기간/가격 등 초세부 수식
 *
 * 검색량 보정:
 *   ≥10,000 → head 보정
 *   1,000~10,000 → mid 보정
 *   <1,000 → longtail 보정
 */
export function classifyKeywordTier(
  keyword: string,
  monthlyVolume?: number | null,
): KeywordTier {
  const tokens = keyword.trim().split(/\s+/).filter(Boolean);
  const tokenCount = tokens.length;

  // 검색량 우선
  if (typeof monthlyVolume === 'number' && monthlyVolume > 0) {
    if (monthlyVolume >= 10000) return 'head';
    if (monthlyVolume >= 1000) return 'mid';
    return 'longtail';
  }

  // fallback — 어절수
  if (tokenCount <= 2) {
    // destination 단독 + 패키지/여행 → head
    const hasDest = KNOWN_DESTINATIONS.some(d => keyword.includes(d));
    if (hasDest) return 'head';
    return 'mid';
  }
  if (tokenCount <= 4) return 'mid';
  return 'longtail';
}

// ── Google Trends RSS ─────────────────────────────────────

/**
 * Google Trends Daily Trends RSS (geo=KR)
 * 키 불필요 — 항상 작동
 *
 * 응답 예:
 *   <item>
 *     <title>여름휴가 추천</title>
 *     <ht:approx_traffic>50,000+</ht:approx_traffic>
 *     <ht:news_item>...</ht:news_item>
 *   </item>
 */
export async function fetchGoogleTrendsRSS(): Promise<TrendKeyword[]> {
  const url = 'https://trends.google.com/trending/rss?geo=KR';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'YeosonamTrendBot/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn('[keyword-research] Google Trends RSS HTTP', res.status);
      return [];
    }
    const xml = await res.text();
    return parseTrendsXml(xml).filter(k => isTravelRelated(k.keyword));
  } catch (err) {
    console.warn('[keyword-research] Google Trends RSS 실패:', err instanceof Error ? err.message : err);
    return [];
  }
}

function parseTrendsXml(xml: string): TrendKeyword[] {
  const items: TrendKeyword[] = [];
  // 단순 정규식 파서 — RSS 2.0 + custom ht: 네임스페이스
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of itemBlocks) {
    const titleMatch = block.match(/<title>([^<]+)<\/title>/);
    if (!titleMatch) continue;
    const keyword = titleMatch[1].trim();
    if (!keyword) continue;

    // approx_traffic — "50,000+" 형식
    const trafficMatch = block.match(/<ht:approx_traffic>([^<]+)<\/ht:approx_traffic>/);
    let traffic = 0;
    if (trafficMatch) {
      traffic = parseInt(trafficMatch[1].replace(/[^\d]/g, ''), 10) || 0;
    }
    // 0~100 점수로 정규화 (10만+이면 100점)
    const score = Math.min(100, Math.round(Math.log10(Math.max(traffic, 1)) * 20));

    items.push({
      keyword,
      source: 'google_trends',
      related_destination: detectDestination(keyword),
      trend_score: score,
      search_volume: traffic > 0 ? traffic : undefined,
      raw: { approx_traffic: trafficMatch?.[1] },
    });
  }
  return items;
}

// ── Naver DataLab — 검색어 트렌드 ─────────────────────────

/**
 * Naver DataLab 통합검색 트렌드 (env: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET)
 * https://developers.naver.com/docs/serviceapi/datalab/search/search.md
 *
 * 무료 1000회/일. 실제 절대 검색량 X, "상대 비율(0~100)" 반환.
 * 따라서 search_volume은 비율을 1만 단위로 곱하는 추정치로 변환.
 */
export async function fetchNaverDataLabTrends(
  keywords: string[],
): Promise<Map<string, { score: number; volume: number }>> {
  const result = new Map<string, { score: number; volume: number }>();
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret || keywords.length === 0) return result;

  try {
    const today = new Date();
    const start = new Date(today);
    start.setMonth(start.getMonth() - 1);

    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // 한 번에 최대 5개 그룹
    const chunks: string[][] = [];
    for (let i = 0; i < keywords.length; i += 5) chunks.push(keywords.slice(i, i + 5));

    for (const chunk of chunks) {
      const body = {
        startDate: fmt(start),
        endDate: fmt(today),
        timeUnit: 'date',
        keywordGroups: chunk.map(k => ({ groupName: k, keywords: [k] })),
      };

      const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
        method: 'POST',
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const groups = (data.results || []) as Array<{ title: string; data: Array<{ ratio: number }> }>;
      for (const g of groups) {
        const ratios = g.data.map(d => d.ratio);
        if (ratios.length === 0) continue;
        const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
        // ratio 평균 0~100 → 추정 월간 검색량 (avg × 200 = 0~20,000 범위)
        result.set(g.title, {
          score: Math.round(avg),
          volume: Math.round(avg * 200),
        });
      }

      // Rate limit 방어
      await new Promise(r => setTimeout(r, 200));
    }
  } catch (err) {
    console.warn('[keyword-research] Naver DataLab 실패:', err instanceof Error ? err.message : err);
  }
  return result;
}

// ── Naver News RSS — 여행/관광면 ───────────────────────────

/**
 * Naver 뉴스 카테고리 RSS — 여행/레저
 * https://news.naver.com/main/list.naver?mode=LSD&mid=shm&sid1=103
 * RSS endpoint: https://rss.donga.com/travel.xml (예시), 단 Naver는 자체 RSS 줄임
 *
 * 대안: Naver Search API (검색 결과 → 여행 헤드라인)
 *   /v1/search/news.json — env: NAVER_CLIENT_ID/SECRET 동일
 */
export async function fetchNaverTravelNews(query: string = '해외여행'): Promise<TrendKeyword[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [];

  try {
    const res = await fetch(
      `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=30&sort=date`,
      {
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret,
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return [];
    const data = await res.json();
    const items = (data.items || []) as Array<{ title: string; description: string; pubDate: string }>;

    // 헤드라인에서 destination + 의도어 키워드 추출
    const keywords = new Map<string, TrendKeyword>();
    for (const item of items) {
      const cleanTitle = item.title.replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, '');
      const dest = detectDestination(cleanTitle);
      if (!dest) continue;

      // destination + 첫 의도어 조합
      for (const intent of TRAVEL_INTENT_WORDS) {
        if (cleanTitle.includes(intent)) {
          const kw = `${dest} ${intent}`;
          if (!keywords.has(kw)) {
            keywords.set(kw, {
              keyword: kw,
              source: 'naver_news',
              related_destination: dest,
              trend_score: 50,  // 뉴스 헤드라인 기본 점수
              raw: { sample_title: cleanTitle.slice(0, 100) },
            });
          }
          break;
        }
      }
    }
    return Array.from(keywords.values());
  } catch (err) {
    console.warn('[keyword-research] Naver News 실패:', err instanceof Error ? err.message : err);
    return [];
  }
}

// ── 통합 리서치 + 캐시 ────────────────────────────────────

const CACHE_TTL_MS = 24 * 3600 * 1000;

/**
 * 캐시 우선 조회 → DataLab/Trends 호출 → 캐시 저장
 */
export async function researchKeyword(keyword: string): Promise<KeywordResearchResult> {
  // 1) 캐시 조회
  try {
    const { data: cached } = await supabaseAdmin
      .from('keyword_research_cache')
      .select('*')
      .eq('keyword', keyword)
      .limit(1);
    if (cached && cached[0]) {
      const row = cached[0];
      const age = Date.now() - new Date(row.fetched_at).getTime();
      if (age < CACHE_TTL_MS) {
        return {
          keyword,
          monthly_search_volume: row.monthly_search_volume,
          competition_level: row.competition_level,
          tier: classifyKeywordTier(keyword, row.monthly_search_volume),
          related_queries: row.related_queries || [],
          source: row.source,
          cached: true,
        };
      }
    }
  } catch { /* 캐시 미스 — 계속 진행 */ }

  // 2) Naver DataLab 호출
  const trendMap = await fetchNaverDataLabTrends([keyword]);
  const t = trendMap.get(keyword);

  const monthly = t?.volume ?? null;
  const score = t?.score ?? null;

  // 경쟁도 추정: head=high / mid=medium / longtail=low
  const tier = classifyKeywordTier(keyword, monthly);
  const competition: CompetitionLevel = tier === 'head' ? 'high' : tier === 'mid' ? 'medium' : 'low';

  // 3) 캐시 저장
  try {
    await supabaseAdmin
      .from('keyword_research_cache')
      .upsert({
        keyword,
        source: t ? 'naver_datalab' : 'fallback',
        monthly_search_volume: monthly,
        competition_level: competition,
        related_queries: [],
        raw: { trend_score: score },
        fetched_at: new Date().toISOString(),
      }, { onConflict: 'keyword' });
  } catch { /* 캐시 저장 실패해도 발행은 진행 */ }

  return {
    keyword,
    monthly_search_volume: monthly,
    competition_level: competition,
    tier,
    related_queries: [],
    source: t ? 'naver_datalab' : 'fallback',
    cached: false,
  };
}

/**
 * 다수 키워드 일괄 조회 (DataLab 5개씩 배치)
 */
export async function researchKeywordsBatch(keywords: string[]): Promise<Map<string, KeywordResearchResult>> {
  const result = new Map<string, KeywordResearchResult>();
  if (keywords.length === 0) return result;

  // 캐시 일괄 조회
  const { data: cached } = await supabaseAdmin
    .from('keyword_research_cache')
    .select('*')
    .in('keyword', keywords);

  const cachedMap = new Map<string, any>();
  for (const row of cached || []) {
    const age = Date.now() - new Date(row.fetched_at).getTime();
    if (age < CACHE_TTL_MS) cachedMap.set(row.keyword, row);
  }

  const missing = keywords.filter(k => !cachedMap.has(k));
  const trendMap = missing.length > 0 ? await fetchNaverDataLabTrends(missing) : new Map();

  // 캐시된 것은 그대로
  for (const [kw, row] of cachedMap) {
    result.set(kw, {
      keyword: kw,
      monthly_search_volume: row.monthly_search_volume,
      competition_level: row.competition_level,
      tier: classifyKeywordTier(kw, row.monthly_search_volume),
      related_queries: row.related_queries || [],
      source: row.source,
      cached: true,
    });
  }

  // 새로 조회한 것
  const upserts: any[] = [];
  for (const kw of missing) {
    const t = trendMap.get(kw);
    const monthly = t?.volume ?? null;
    const tier = classifyKeywordTier(kw, monthly);
    const competition: CompetitionLevel = tier === 'head' ? 'high' : tier === 'mid' ? 'medium' : 'low';

    result.set(kw, {
      keyword: kw,
      monthly_search_volume: monthly,
      competition_level: competition,
      tier,
      related_queries: [],
      source: t ? 'naver_datalab' : 'fallback',
      cached: false,
    });

    upserts.push({
      keyword: kw,
      source: t ? 'naver_datalab' : 'fallback',
      monthly_search_volume: monthly,
      competition_level: competition,
      related_queries: [],
      raw: { trend_score: t?.score ?? null },
      fetched_at: new Date().toISOString(),
    });
  }

  if (upserts.length > 0) {
    try {
      await supabaseAdmin.from('keyword_research_cache').upsert(upserts, { onConflict: 'keyword' });
    } catch { /* */ }
  }

  return result;
}

// ── 트렌드 통합 (마이너용) ────────────────────────────────

/**
 * 모든 트렌드 소스에서 키워드 수집 (마이너 크론이 호출)
 * 중복 제거 + destination 매칭 + 트래블 필터
 */
export async function collectAllTrends(): Promise<TrendKeyword[]> {
  const [google, news] = await Promise.all([
    fetchGoogleTrendsRSS().catch(() => []),
    fetchNaverTravelNews('해외여행').catch(() => []),
  ]);

  // 추가 쿼리 — 시즌별 의도어
  const seasonalQueries = ['여름휴가', '추석연휴', '신혼여행', '효도여행'];
  const newsExtra = await Promise.all(
    seasonalQueries.map(q => fetchNaverTravelNews(q).catch(() => [])),
  );

  const all = [...google, ...news, ...newsExtra.flat()];

  // 중복 제거 (키워드 정규화 + 점수 max)
  const dedup = new Map<string, TrendKeyword>();
  for (const k of all) {
    const norm = k.keyword.trim().toLowerCase();
    const existing = dedup.get(norm);
    if (!existing || (k.trend_score ?? 0) > (existing.trend_score ?? 0)) {
      dedup.set(norm, k);
    }
  }

  return Array.from(dedup.values());
}
