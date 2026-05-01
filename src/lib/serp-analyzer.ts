/**
 * SERP Analyzer — 키워드 경쟁강도 분석 + 최적 SEO 제목/엔티티 추출
 *
 * 흐름:
 *   1. Naver Search API (blog + web) 상위 10개 fetch
 *   2. serp_snapshots 캐시 저장 (7일 TTL)
 *   3. 패턴 추출:
 *      - 제목 평균 길이 / 년도 포함률 / 대괄호 사용률 / power word 빈도
 *      - 본문 스니펫에서 자주 등장하는 엔티티 (관광지/호텔/지명/항공사)
 *   4. blog-publisher prompt에 "## SERP 분석" 블록으로 주입
 *
 * 비용 보호:
 *   - HEAD/MID tier만 호출 (longtail은 SERP 분석 가치 낮음)
 *   - 7일 캐시 → 같은 키워드 1주일에 1회만 fetch
 *   - Naver 1000회/일 무료 쿼터 안에서 충분
 */

import { supabaseAdmin } from './supabase';
import { detectDestination } from './keyword-research';

const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

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
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
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
  const nextYear = currentYear + 1;
  const yearMatches = titles.filter(t => t.includes(String(currentYear)) || t.includes(String(nextYear))).length;
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

  // 추천 제목 패턴
  const recommendedTitles: string[] = [];
  const dominantPower = powerWords[0]?.word;
  if (yearRate > 0.5) recommendedTitles.push(`${nextYear} 트렌드 반영 — 제목에 "${nextYear}" 포함 권장`);
  if (bracketRate > 0.4) recommendedTitles.push(`상위 글의 ${(bracketRate * 100).toFixed(0)}%가 [..] 또는 (..) 사용`);
  if (dominantPower) recommendedTitles.push(`Power word "${dominantPower}" 포함 ${powerCount.get(dominantPower)}/10회 — 강력 권장`);
  if (avgLen > 0) recommendedTitles.push(`상위 평균 ${avgLen}자 — Naver 모바일 최적은 30-55자`);

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
      if (age < CACHE_TTL_MS) {
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
          recommended_title_patterns: row.raw?.recommended_title_patterns || [],
          recommended_entities_to_include: (row.entities || []).slice(0, 6).map((e: any) => e.entity),
        };
      }
    }
  } catch { /* 캐시 미스 */ }

  // 2) SERP fetch
  const snippets = await fetchNaverSerp(keyword, source);
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
        snippets_count: snippets.length,
      },
      fetched_at: fetchedAt,
    }, { onConflict: 'keyword' });
  } catch { /* */ }

  return {
    keyword,
    source,
    fetched_at: fetchedAt,
    cached: false,
    ...patterns,
  };
}

/**
 * blog-publisher가 호출 — SERP 분석 결과를 prompt 블록으로 변환
 */
export function buildSerpPromptBlock(analysis: SerpAnalysis | null): string {
  if (!analysis) return '';

  const lines: string[] = [];
  lines.push('## 🎯 경쟁 SERP 분석 (Naver 상위 10개)');
  lines.push(`- 평균 제목 길이: ${analysis.avg_title_len}자 (당신의 SEO 제목도 ${analysis.avg_title_len > 50 ? '40~55자' : '30~45자'} 권장)`);
  if (analysis.power_words.length > 0) {
    const top3 = analysis.power_words.slice(0, 3).map(p => `${p.word}(${p.count}/10)`).join(', ');
    lines.push(`- 상위 Power Word: ${top3} → 제목에 1개 이상 포함 강력 권장`);
  }
  if (analysis.year_inclusion_rate > 0.4) {
    lines.push(`- 상위 ${(analysis.year_inclusion_rate * 100).toFixed(0)}%가 "${new Date().getFullYear() + 1}" 또는 "${new Date().getFullYear()}" 포함 — 제목에 년도 포함`);
  }
  if (analysis.bracket_rate > 0.3) {
    lines.push(`- 상위 ${(analysis.bracket_rate * 100).toFixed(0)}%가 [..] 또는 (..) 형식 사용 — 시각적 차별화`);
  }
  if (analysis.recommended_entities_to_include.length > 0) {
    lines.push(`- 상위 글에 자주 언급되는 엔티티 (본문에 자연스럽게 포함 권장): ${analysis.recommended_entities_to_include.join(', ')}`);
  }
  lines.push('');
  lines.push('이 패턴을 참고하되 표절 금지. 토픽 본질 + 여소남 톤 유지.');
  return lines.join('\n');
}

/**
 * SERP 분석 결과를 반영한 최적 SEO 제목 생성
 *
 * 규칙:
 *   1. 상위 50% 이상이 연도 포함 → 제목 끝에 "(2026)" 추가
 *   2. 상위 top power word가 제목에 없으면 삽입 (길이 허용 시)
 *   3. 대괄호 rate > 50% → 이미 포함 여부 확인 후 삽입
 *   4. 최종 길이 30~55자 내 유지
 */
export function buildOptimalTitle(
  baseTopic: string,
  analysis: SerpAnalysis,
  tier: 'head' | 'mid' | 'longtail' = 'mid',
): string {
  const year = new Date().getFullYear();
  let title = baseTopic.substring(0, 55).trim();

  // 연도 포함율 > 50% → 아직 없으면 추가
  if (analysis.year_inclusion_rate > 0.5) {
    if (!title.includes(String(year)) && !title.includes(String(year + 1))) {
      const candidate = `${title} (${year})`;
      if (candidate.length <= 55) title = candidate;
    }
  }

  // 상위 power word 1개가 없으면 삽입 (head/mid만)
  if (tier !== 'longtail' && analysis.power_words.length > 0) {
    const topWord = analysis.power_words[0].word;
    // 연도·숫자 power word는 제목에 추가 불필요 (이미 처리)
    if (!/^\d{4}$/.test(topWord) && !title.includes(topWord)) {
      const withWord = `${title} — ${topWord}`;
      if (withWord.length <= 55) title = withWord;
    }
  }

  // 대괄호 rate > 50% → 앞에 분류 태그 추가 (head tier만, 공간 여유 있을 때)
  if (tier === 'head' && analysis.bracket_rate > 0.5) {
    if (!/^\[/.test(title)) {
      const tag = '[완벽 가이드]';
      const withTag = `${tag} ${title}`;
      if (withTag.length <= 55) title = withTag;
    }
  }

  return title.substring(0, 60);
}
