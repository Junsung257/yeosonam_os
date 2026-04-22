/**
 * 블로그 3-Gate 자동 품질 검증
 *
 * 풀-자동 발행 전에 통과해야 하는 최소 기준.
 * 실패 시 content_creatives.status='failed' 로 강등하고 quality_gate JSONB 에 사유 기록.
 *
 * Gate 1 — 길이: 본문 800자 이상 (thin content 방어)
 * Gate 2 — 클리셰 감지: style-guide 금지어 3개 이상 등장하면 실패
 * Gate 3 — 중복 방어: 최근 14일 내 동일 slug / (destination+angle_type) 존재하면 실패
 *
 * 통과 시 → 발행 허용. 실패 시 → draft 강등 + 재시도 1회.
 */

import { supabaseAdmin } from './supabase';

// style-guide.ts 의 "절대 금지 표현 2) AI 클리셰 형용사" 와 동기화.
// 여기만 수정하면 생성/검증 양쪽이 같은 기준을 사용.
export const BANNED_CLICHES = [
  '아름다운', '환상적인', '완벽한', '특별한', '매력적인',
  '잊지 못할', '놓치지 마세요', '꼭 가봐야 할', '최고의',
  '인생샷', '설레는', '힘찬', '낭만적인',
  '제대로', '알찬', '만끽', '힐링',
  '한 번쯤은 경험해 볼 만한', '추억에 남는',
];

// Blog 유형별 임계값 (product = 랜딩페이지 / info = 장문 SEO)
const THRESHOLDS = {
  product: { minLen: 1200, maxCliche: 2, maxKeywordDensity: 1.5 },
  info:    { minLen: 1800, maxCliche: 2, maxKeywordDensity: 1.2 },
} as const;

const DEDUP_WINDOW_DAYS = 14;

export interface GateResult {
  gate: 'length' | 'cliche' | 'duplicate' | 'keyword_density';
  passed: boolean;
  reason?: string;
  evidence?: Record<string, unknown>;
}

export interface QualityGateReport {
  passed: boolean;
  gates: GateResult[];
  summary: string;
  checkedAt: string;
}

interface CheckInput {
  blog_html: string;
  slug: string;
  destination?: string | null;
  angle_type?: string | null;
  excludeContentCreativeId?: string | null;
  blog_type?: 'product' | 'info';   // 임계값 분기 (기본 product)
  primary_keyword?: string | null;  // 키워드 밀도 측정 대상
}

// 마크다운/HTML 태그 제거해서 순수 텍스트 길이 측정
function stripMarkup(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/#{1,6}\s+/g, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function checkLength(blog_html: string, blog_type: 'product' | 'info' = 'product'): GateResult {
  const text = stripMarkup(blog_html);
  const length = text.length;
  const minLen = THRESHOLDS[blog_type].minLen;
  return {
    gate: 'length',
    passed: length >= minLen,
    reason: length < minLen
      ? `본문 ${length}자 — ${blog_type} 최소 ${minLen}자 미달 (thin content)`
      : undefined,
    evidence: { length, min: minLen, type: blog_type },
  };
}

export function checkKeywordDensity(
  blog_html: string,
  primary_keyword: string | null | undefined,
  blog_type: 'product' | 'info' = 'product',
): GateResult {
  if (!primary_keyword) {
    // 키워드 미지정 시 패스 (관대)
    return { gate: 'keyword_density', passed: true, evidence: { skipped: 'no primary keyword' } };
  }
  const text = stripMarkup(blog_html);
  const charLen = text.length;
  if (charLen === 0) {
    return { gate: 'keyword_density', passed: false, reason: '본문 없음' };
  }

  const re = new RegExp(primary_keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  const matches = text.match(re);
  const count = matches ? matches.length : 0;
  // 밀도 = (키워드 * 키워드길이) / 본문길이 * 100
  const density = (count * primary_keyword.length / charLen) * 100;
  const maxDensity = THRESHOLDS[blog_type].maxKeywordDensity;

  return {
    gate: 'keyword_density',
    passed: density <= maxDensity,
    reason: density > maxDensity
      ? `"${primary_keyword}" 키워드 밀도 ${density.toFixed(2)}% (허용 ${maxDensity}%) · ${count}회 등장 — 스터핑 위험`
      : undefined,
    evidence: { keyword: primary_keyword, count, density: +density.toFixed(2), max: maxDensity },
  };
}

export function checkCliche(blog_html: string, blog_type: 'product' | 'info' = 'product'): GateResult {
  const text = stripMarkup(blog_html);
  const hits: Array<{ word: string; count: number }> = [];
  let totalCount = 0;

  for (const word of BANNED_CLICHES) {
    const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const matches = text.match(re);
    if (matches && matches.length > 0) {
      hits.push({ word, count: matches.length });
      totalCount += matches.length;
    }
  }
  const maxCliche = THRESHOLDS[blog_type].maxCliche;

  return {
    gate: 'cliche',
    passed: totalCount <= maxCliche,
    reason: totalCount > maxCliche
      ? `AI 클리셰 ${totalCount}회 감지 (허용 ${maxCliche}회) · ${hits.slice(0, 5).map(h => `${h.word}(${h.count})`).join(', ')}`
      : undefined,
    evidence: { totalCount, hits, maxAllowed: maxCliche },
  };
}

export async function checkDuplicate(input: CheckInput): Promise<GateResult> {
  const since = new Date();
  since.setDate(since.getDate() - DEDUP_WINDOW_DAYS);
  const sinceIso = since.toISOString();

  // 1) slug 중복
  const slugQuery = supabaseAdmin
    .from('content_creatives')
    .select('id, slug')
    .eq('slug', input.slug)
    .eq('channel', 'naver_blog')
    .in('status', ['published', 'scheduled', 'draft']);

  if (input.excludeContentCreativeId) {
    slugQuery.neq('id', input.excludeContentCreativeId);
  }

  const { data: slugDupes } = await slugQuery.limit(1);
  if (slugDupes && slugDupes.length > 0) {
    return {
      gate: 'duplicate',
      passed: false,
      reason: `동일 slug 이미 존재: ${input.slug}`,
      evidence: { type: 'slug', existing_id: slugDupes[0].id },
    };
  }

  // 2) (destination + angle_type) 14일 내 중복
  if (input.destination && input.angle_type) {
    // travel_packages JOIN — destination 필터
    const { data: angleDupes } = await supabaseAdmin
      .from('content_creatives')
      .select('id, slug, travel_packages!inner(destination)')
      .eq('angle_type', input.angle_type)
      .eq('travel_packages.destination', input.destination)
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .gte('published_at', sinceIso)
      .limit(1);

    if (angleDupes && angleDupes.length > 0) {
      return {
        gate: 'duplicate',
        passed: false,
        reason: `최근 ${DEDUP_WINDOW_DAYS}일 내 ${input.destination} + ${input.angle_type} 이미 발행됨`,
        evidence: { type: 'destination_angle', existing_slug: angleDupes[0].slug },
      };
    }
  }

  return { gate: 'duplicate', passed: true };
}

export async function runQualityGates(input: CheckInput): Promise<QualityGateReport> {
  const blogType = input.blog_type ?? 'product';
  const gates: GateResult[] = [];

  gates.push(checkLength(input.blog_html, blogType));
  gates.push(checkCliche(input.blog_html, blogType));
  gates.push(await checkDuplicate(input));
  gates.push(checkKeywordDensity(input.blog_html, input.primary_keyword, blogType));

  const failed = gates.filter(g => !g.passed);
  const summary = failed.length === 0
    ? `모든 게이트 통과 (${blogType})`
    : `${failed.length}/${gates.length} 실패: ${failed.map(f => `[${f.gate}] ${f.reason}`).join(' · ')}`;

  return {
    passed: failed.length === 0,
    gates,
    summary,
    checkedAt: new Date().toISOString(),
  };
}
