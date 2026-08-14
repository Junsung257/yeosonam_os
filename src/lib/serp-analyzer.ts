/**
 * Legacy SERP compatibility adapter.
 *
 * 흐름:
 *   1. Naver Search API (blog + web) 상위 10개 fetch
 *   2. serp_snapshots 캐시 저장 (7일 TTL)
 *   3. 패턴 추출:
 * V3 publishing uses blog-serp-research-v3. This adapter keeps older pillar
 * callers operational, but title gimmicks and mandatory keyword/H2 insertion
 * are intentionally disabled.
 *
 * 비용 보호:
 *   - HEAD/MID tier만 호출 (longtail은 SERP 분석 가치 낮음)
 *   - 7일 캐시 → 같은 키워드 1주일에 1회만 fetch
 *   - Naver 1000회/일 무료 쿼터 안에서 충분
 */

import { supabaseAdmin } from './supabase';
import { detectDestination } from './keyword-research';
import { getSecret } from './secret-registry';

const CACHE_TTL_MS = 7 * 24 * 3600 * 1000; // 기본 7일 — 저경쟁 키워드

/** 키워드 경쟁도에 따라 캐시 TTL 동적 계산 */
function getDynamicCacheTtl(keyword: string): number {
  // 고경쟁 시그널: 짧은 키워드(1-2단어), '추천','비교','가격' 등 포함
  const wordCount = keyword.split(/\s+/).filter(Boolean).length;
  const highCompetition = wordCount <= 2 ||
    /\b(추천|비교|가격|베스트|TOP|순위|랭킹)\b/.test(keyword);
  // 저경쟁 시그널: 긴 키워드(4+단어), 특정 질문 패턴
  const lowCompetition = wordCount >= 4 ||
    /\b(여행|방문|가볼만한)\b/.test(keyword) === false;

  if (highCompetition) return 6 * 3600 * 1000;  // 고경쟁: 6시간
  if (lowCompetition) return 48 * 3600 * 1000;  // 저경쟁: 48시간
  return CACHE_TTL_MS; // 중간: 7일
}

// 한국 SEO에서 검증된 power word (Naver 블로그 상위 노출 빈출)
const POWER_WORDS = [
  '완벽', '총정리', '추천', '가이드', '비교', '리뷰', '분석',
  '꿀팁', '체크리스트', '가성비', '실제', '직접', '현지',
  '베스트', 'TOP', '랭킹', '최신', '2025', '2026',
];

const KNOWN_ENTITIES_PATTERNS = [
  // 관광지/호텔/항공사 패턴 (한국어 + 영문)
  /([가-힣]{2,8}(타워|공원|해변|성|리조트|호텔|시장|폭포|동굴|박물관|궁|사|섬))/g,
  /([A-Z][a-z]+\s?(Resort|Hotel|Tower|Park|Beach|Bay|Island))/g,
  /(에어|항공|에어라인)/g,
];

export interface SerpSnippet {
  rank: number;
  title: string;
  url: string;
  snippet: string;
}

export interface SerpAnalysis {
  keyword: string;
  source: string;
  fetched_at: string;
  cached: boolean;
  signal_source?: 'naver_serp' | 'free_google_suggest';
  // 제목 패턴
  avg_title_len: number;
  power_words: Array<{ word: string; count: number }>;
  year_inclusion_rate: number;
  bracket_rate: number;
  // 본문 분석
  entities: Array<{ entity: string; count: number }>;
  // 추천
  recommended_title_patterns: string[];
  recommended_entities_to_include: string[];
}

/**
 * Naver 검색 API (blog) — 상위 10개 fetch
 */
async function fetchNaverSerp(
  keyword: string,
  source: 'naver_blog' | 'naver_web' = 'naver_blog',
): Promise<SerpSnippet[]> {
  const clientId = getSecret('NAVER_CLIENT_ID');
  const clientSecret = getSecret('NAVER_CLIENT_SECRET');
  if (!clientId || !clientSecret) return [];

  const path = source === 'naver_blog' ? 'blog' : 'webkr';
  try {
    const res = await fetch(
      `https://openapi.naver.com/v1/search/${path}.json?query=${encodeURIComponent(keyword)}&display=10&sort=sim`,
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
    const items = (data.items || []) as Array<{ title: string; description: string; link: string }>;
    return items.slice(0, 10).map((it, idx) => ({
      rank: idx + 1,
      title: stripHtml(it.title),
      url: it.link,
      snippet: stripHtml(it.description),
    }));
  } catch {
    return [];
  }
}

export function parseGoogleSuggestPayload(payload: unknown, keyword: string): SerpSnippet[] {
  if (!Array.isArray(payload)) return [];
  const suggestions = Array.isArray(payload[1]) ? payload[1] : [];
  return suggestions
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((title, idx) => ({
      rank: idx + 1,
      title: stripHtml(title),
      url: `https://www.google.com/search?q=${encodeURIComponent(title)}`,
      snippet: `${keyword} related search intent suggestion`,
    }))
    .slice(0, 10);
}

async function fetchGoogleSuggestSnippets(keyword: string): Promise<SerpSnippet[]> {
  const queries = [
    keyword,
    `${keyword} 날씨`,
    `${keyword} 준비물`,
    `${keyword} 옷차림`,
  ];
  const snippets: SerpSnippet[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    try {
      const res = await fetch(
        `https://suggestqueries.google.com/complete/search?client=firefox&hl=ko&gl=kr&q=${encodeURIComponent(query)}`,
        {
          headers: { 'User-Agent': 'YeosonamSearchIntentBot/1.0' },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!res.ok) continue;
      const parsed = parseGoogleSuggestPayload(await res.json(), keyword);
      for (const item of parsed) {
        const key = item.title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        snippets.push({ ...item, rank: snippets.length + 1 });
        if (snippets.length >= 10) break;
      }
      if (snippets.length >= 10) break;
    } catch {
      // Free suggest is best-effort. A failure must not block publishing.
    }
  }

  return snippets.slice(0, 10);
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&[a-zA-Z]+;/g, ' ').trim();
}

/**
 * SERP 패턴 추출 — 제목·엔티티
 */
function extractPatterns(snippets: SerpSnippet[]): Omit<SerpAnalysis, 'keyword' | 'source' | 'fetched_at' | 'cached'> {
  if (snippets.length === 0) {
    return {
      avg_title_len: 0,
      power_words: [],
      year_inclusion_rate: 0,
      bracket_rate: 0,
      entities: [],
      recommended_title_patterns: [],
      recommended_entities_to_include: [],
    };
  }

  const titles = snippets.map(s => s.title);
  const avgLen = Math.round(titles.reduce((a, t) => a + t.length, 0) / titles.length * 10) / 10;

  // Power word 빈도
  const powerCount = new Map<string, number>();
  for (const t of titles) {
    for (const w of POWER_WORDS) {
      if (t.includes(w)) {
        powerCount.set(w, (powerCount.get(w) ?? 0) + 1);
      }
    }
  }
  const powerWords = Array.from(powerCount.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // 년도 포함률
  const currentYear = new Date().getFullYear();
  const yearMatches = titles.filter(t => t.includes(String(currentYear)) || t.includes(String(currentYear + 1))).length;
  const yearRate = +(yearMatches / titles.length).toFixed(2);

  // 대괄호 사용률
  const bracketMatches = titles.filter(t => /[\[(【]/.test(t)).length;
  const bracketRate = +(bracketMatches / titles.length).toFixed(2);

  // 엔티티 추출 (제목 + 스니펫 종합)
  const fullText = snippets.map(s => `${s.title} ${s.snippet}`).join(' ');
  const entityCount = new Map<string, number>();
  for (const pattern of KNOWN_ENTITIES_PATTERNS) {
    const matches = fullText.matchAll(pattern);
    for (const m of matches) {
      const e = m[1].trim();
      if (e.length < 3 || e.length > 20) continue;
      entityCount.set(e, (entityCount.get(e) ?? 0) + 1);
    }
  }
  const entities = Array.from(entityCount.entries())
    .map(([entity, count]) => ({ entity, count }))
    .filter(e => e.count >= 2)  // 2회 이상 등장한 것만
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // Descriptive observations only. Frequency never authorizes copying a title
  // pattern, adding a year, or inserting a promotional word.
  const recommendedTitles: string[] = [];
  if (avgLen > 0) recommendedTitles.push(`표본 평균 제목 길이 ${avgLen}자 (관찰값이며 목표값이 아님)`);

  return {
    avg_title_len: avgLen,
    power_words: powerWords,
    year_inclusion_rate: yearRate,
    bracket_rate: bracketRate,
    entities,
    recommended_title_patterns: recommendedTitles,
    recommended_entities_to_include: entities.slice(0, 6).map(e => e.entity),
  };
}

/**
 * 키워드 1개 분석 (캐시 우선) — blog-publisher가 호출
 */
export async function analyzeSerp(
  keyword: string,
  source: 'naver_blog' | 'naver_web' = 'naver_blog',
): Promise<SerpAnalysis | null> {
  // 1) 캐시 조회
  try {
    const { data: cached } = await supabaseAdmin
      .from('serp_analysis')
      .select('*')
      .eq('keyword', keyword)
      .eq('source', source)
      .limit(1);
    if (cached?.[0]) {
      const row = cached[0];
      const age = Date.now() - new Date(row.fetched_at).getTime();
      const ttl = getDynamicCacheTtl(keyword);
      if (age < ttl) {
        return {
          keyword,
          source,
          fetched_at: row.fetched_at,
          cached: true,
          avg_title_len: row.avg_title_len,
          power_words: row.power_words || [],
          year_inclusion_rate: row.year_inclusion_rate,
          bracket_rate: row.bracket_rate,
          entities: row.entities || [],
          signal_source: row.raw?.signal_source || 'naver_serp',
          recommended_title_patterns: row.raw?.recommended_title_patterns || [],
          recommended_entities_to_include: row.raw?.recommended_entities_to_include
            || (row.entities || []).slice(0, 6).map((e: any) => e.entity),
        };
      }
    }
  } catch { /* 캐시 미스 */ }

  // 2) SERP fetch. If Naver keys are unavailable, use free autocomplete intent signals.
  let signalSource: SerpAnalysis['signal_source'] = 'naver_serp';
  let snippets = await fetchNaverSerp(keyword, source);
  if (snippets.length === 0) {
    snippets = await fetchGoogleSuggestSnippets(keyword);
    if (snippets.length > 0) signalSource = 'free_google_suggest';
  }
  if (snippets.length === 0) return null;

  // 3) 스냅샷 저장
  const fetchedAt = new Date().toISOString();
  try {
    await supabaseAdmin.from('serp_snapshots').upsert(
      snippets.map(s => ({
        keyword,
        source,
        rank: s.rank,
        title: s.title,
        url: s.url,
        snippet: s.snippet,
        fetched_at: fetchedAt,
      })),
      { onConflict: 'keyword,source,rank,fetched_at', ignoreDuplicates: true },
    );
  } catch { /* */ }

  // 4) 패턴 분석
  const patterns = extractPatterns(snippets);
  if (signalSource === 'free_google_suggest') {
    const freeSuggestions = snippets.map((snippet) => snippet.title).slice(0, 6);
    patterns.recommended_title_patterns = [
      ...patterns.recommended_title_patterns,
      `Free autocomplete intent signals: ${freeSuggestions.join(' / ')}`,
    ];
    patterns.recommended_entities_to_include = [
      ...new Set([
        ...patterns.recommended_entities_to_include,
        ...freeSuggestions,
      ]),
    ].slice(0, 8);
  }

  // 5) 분석 결과 캐시
  try {
    await supabaseAdmin.from('serp_analysis').upsert({
      keyword,
      source,
      avg_title_len: patterns.avg_title_len,
      power_words: patterns.power_words,
      year_inclusion_rate: patterns.year_inclusion_rate,
      bracket_rate: patterns.bracket_rate,
      entities: patterns.entities,
      recommended_title_pattern: patterns.recommended_title_patterns.join(' / '),
      raw: {
        recommended_title_patterns: patterns.recommended_title_patterns,
        recommended_entities_to_include: patterns.recommended_entities_to_include,
        snippets_count: snippets.length,
        signal_source: signalSource,
      },
      fetched_at: fetchedAt,
    }, { onConflict: 'keyword' });
  } catch { /* */ }

  return {
    keyword,
    source,
    fetched_at: fetchedAt,
    cached: false,
    signal_source: signalSource,
    ...patterns,
  };
}

/**
 * blog-publisher가 호출 — SERP 분석 결과를 prompt 블록으로 변환
 */
export function buildSerpPromptBlock(
  analysis: SerpAnalysis | null,
  serpGapAnalysis?: { missingTopics: string[]; coverageScore: number; suggestions: string[] },
): string {
  if (!analysis && !serpGapAnalysis) return '';

  const lines: string[] = [];
  if (analysis?.signal_source === 'free_google_suggest') {
    lines.push('## Search Intent Signals (free Google Suggest fallback)');
    lines.push('- Naver SERP API keys were unavailable or returned no data, so this uses autocomplete intent signals. Use this for keyword/intent guidance, not ranking proof.');
    lines.push('');
  }

  if (analysis) {
    lines.push('## 검색 의도 참고 표본 (Naver editorial 결과)');
    lines.push(`- 분석 표본의 평균 제목 길이: ${analysis.avg_title_len}자 (관찰값이며 제목 목표값이 아님)`);
    if (analysis.recommended_entities_to_include.length > 0) {
      lines.push(`- 표본에서 반복 관찰된 엔티티: ${analysis.recommended_entities_to_include.join(', ')}`);
    }
    lines.push('');
    lines.push('이 값으로 연도, power word, 대괄호, 엔티티를 강제하지 말 것. 검색 의도만 참고하고 사실은 공식 claim packet으로 검증한다.');
  }

  // 갭 분석 결과 주입
  if (serpGapAnalysis && serpGapAnalysis.missingTopics.length > 0) {
    lines.push('');
    lines.push('## ⚠️ 부족한 주제 (경쟁사 대비)');
    lines.push(`현재 글의 주제 커버리지 점수: ${serpGapAnalysis.coverageScore}/100`);
    lines.push(`경쟁사 상위 글에서 다루지만 이 글에 없는 주제:`);
    for (const topic of serpGapAnalysis.missingTopics) {
      lines.push(`- "${topic}" — 독자의 결정에 필요한지 먼저 판단하세요`);
    }
    lines.push('');
    lines.push('위 항목은 의무 H2 목록이 아니며, 근거와 검색 의도에 맞는 항목만 사용합니다.');
  }

  return lines.join('\n');
}

/**
 * SERP 분석 결과를 반영한 최적 SEO 제목 생성
 *
 * V3 rule: the query and article answer determine the title. Observed SERP
 * formatting never adds a year, power word, bracket, or episode suffix.
 */
export function buildOptimalTitle(
  baseTopic: string,
  analysis: SerpAnalysis,
  tier: 'head' | 'mid' | 'longtail' = 'mid',
): string {
  void analysis;
  void tier;
  return baseTopic
    .replace(/\s*\((?:2|3|4)편\)\s*$/u, '')
    .replace(/\s+(?:완벽|최고|필수|총정리|BEST)\s*$/iu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}
