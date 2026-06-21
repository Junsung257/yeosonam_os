/**
 * 블로그 3-Gate 자동 품질 검증
 *
 * 풀-자동 발행 전에 통과해야 하는 최소 기준.
 * 임계값은 blog-bayesian-optimizer 에서 데이터 기반 자동 조정 가능.
 *
 * Gate 1 — 길이: 본문 800자 이상 (thin content 방어)
 * Gate 2 — 클리셰 감지: style-guide 금지어 3개 이상 등장하면 실패
 * Gate 3 — 중복 방어: 최근 14일 내 동일 slug / (destination+angle_type) 존재하면 실패
 */

import { supabaseAdmin } from './supabase';
import { checkReadability } from './blog-readability';
import { stripMarkup } from './blog-text-utils';
import { slugifyTopic } from './slug-utils';
import { getActiveThresholds, type AdaptiveThresholds } from './blog-bayesian-optimizer';
import { inspectRenderedBlogIntegrity, renderBlogContentToHtml } from './blog-renderer';
import { inspectBlogImageQuality } from './blog-image-quality';
import { inspectBlogStructure } from './blog-structure-audit';
import { inspectBlogIntentQuality } from './blog-content-intent';
import { evaluateBlogEditorialQuality, evaluateBlogTopicFit } from './blog-topic-fit-gate';

// style-guide.ts 의 "절대 금지 표현 2) AI 클리셰 형용사" 와 동기화.
// 여기만 수정하면 생성/검증 양쪽이 같은 기준을 사용.
export const BANNED_CLICHES = [
  '아름다운', '환상적인', '완벽한', '특별한', '매력적인',
  '잊지 못할', '놓치지 마세요', '꼭 가봐야 할', '최고의',
  '인생샷', '설레는', '힘찬', '낭만적인',
  '제대로', '알찬', '만끽', '힐링',
  '한 번쯤은 경험해 볼 만한', '추억에 남는',
  '독특한', '다양한', '편안한', '인기 있는', '유명한',
  '숨겨진', '잘 알려지지 않은', '이국적인',
  '만족스러운', '무난한', '훌륭한', '뛰어난',
  '여행의 묘미', '색다른 경험', '잊을 수 없는 추억',
  '완전히 새로운', '놀라운', '생각지도 못한',
];

// Blog 유형별 임계값 (product = 랜딩페이지 / info = 장문 SEO)
const THRESHOLDS = {
  product: { minLen: 1200, maxCliche: 2, maxKeywordDensity: 2.5 },
  info:    { minLen: 2500, maxCliche: 8, maxKeywordDensity: 1.8 },
} as const;

const DEDUP_WINDOW_DAYS = 14;
const GENERIC_SLUG_PREFIXES = new Set([
  'travel-guide',
  'package-guide',
  'complete-guide',
  'weather-guide',
  'preparation-guide',
  'budget-guide',
  'food-guide',
  'local-info',
]);

export interface GateResult {
  gate: 'length' | 'cliche' | 'duplicate' | 'keyword_density' | 'hook' | 'cta' | 'links' | 'readability' | 'ai_readability' | 'render_integrity' | 'structure_integrity' | 'topic_fit' | 'intent_quality' | 'editorial_quality' | 'image_quality' | 'accent_density';
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
  category?: string | null;
  content_type?: string | null;
  product_id?: string | null;
  skipFuzzyDuplicate?: boolean;
}

function getSpecificSlugPrefix(slug: string): string | null {
  const tokens = slug
    .split('-')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length < 2) return null;

  const firstTwo = tokens.slice(0, 2).join('-');
  if (GENERIC_SLUG_PREFIXES.has(firstTwo)) return null;

  const prefix = tokens.slice(0, Math.min(4, Math.max(2, tokens.length - 1))).join('-');
  if (prefix.length < 8 || !/^[a-z0-9-]+$/.test(prefix)) return null;
  return prefix;
}

function shouldCheckDestinationAngleDuplicate(input: CheckInput): boolean {
  if (!input.destination || !input.angle_type || input.skipFuzzyDuplicate) return false;
  if (input.product_id) return false;
  if (input.blog_type === 'product') return false;
  if (input.content_type === 'package_intro') return false;
  if (input.category === 'product_intro') return false;
  return true;
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

/**
 * Hook 게이트 — 첫 H1 다음 200자 안에 구체적 트리거 1개 이상.
 * 트리거: 숫자 1개 이상 + (질문 마크 OR 가격 표현 OR 시간 표현 OR 비교 표현)
 * Why: AI가 쓴 평탄한 도입부 ("...꿈꾸시나요?") 차단. 검색자 3초 이탈 방어.
 */
export function checkHook(blog_html: string): GateResult {
  // 마크다운 원문에서 H1 위치를 명시적으로 찾는다 (stripMarkup 후엔 # 마커가 사라져 H1 식별 불가).
  const rawLines = blog_html.split('\n');
  const h1Idx = rawLines.findIndex(l => /^#\s/.test(l.trim()));
  // H1 이 없으면 본문 첫 줄부터, 있으면 H1 다음부터
  const startIdx = h1Idx >= 0 ? h1Idx + 1 : 0;
  const afterH1Raw = rawLines.slice(startIdx).join('\n');
  const text = stripMarkup(afterH1Raw);
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  // 도입부 200자 (H1 다음 첫 본문)
  const intro = lines.join(' ').slice(0, 200);
  if (intro.length < 50) {
    return {
      gate: 'hook',
      passed: false,
      reason: `도입부 ${intro.length}자 — 200자 내용 부족`,
      evidence: { intro_length: intro.length },
    };
  }
  // 트리거 검출
  const hasNumber = /\d/.test(intro);
  const hasQuestion = /[?？]/.test(intro);
  const hasPriceHook = /(만원|원|만\s|절약|저렴|차이|할인|특가)/.test(intro);
  const hasTimeHook = /(\d+분|\d+시간|즉시|당일|바로)/.test(intro);
  const hasCompare = /(시중가|단품|직접|비교|보다)/.test(intro);

  const triggers = [hasQuestion, hasPriceHook, hasTimeHook, hasCompare].filter(Boolean).length;
  // 숫자 + 트리거 1개 이상 OR 트리거 2개 이상
  const passed = (hasNumber && triggers >= 1) || triggers >= 2;

  return {
    gate: 'hook',
    passed,
    reason: passed
      ? undefined
      : '도입부 200자에 구체 갈고리(숫자·질문·가격·시간·비교 트리거) 부족 — AI 평서문 패턴 의심',
    evidence: {
      intro_preview: intro.slice(0, 80),
      hasNumber, hasQuestion, hasPriceHook, hasTimeHook, hasCompare, triggers,
    },
  };
}

/**
 * CTA 게이트 — 본문에 CTA 링크 2개 이상 (3-tier 분산 의도).
 * 마크다운 \[..\](https?://...) 또는 \[..\](/path) 카운트.
 * "blog_top·blog_mid·blog_bottom" UTM 패턴이 있으면 가산점.
 */
export function checkCta(blog_html: string): GateResult {
  // 모든 마크다운 링크 추출
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links: { text: string; url: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(blog_html)) !== null) {
    links.push({ text: m[1], url: m[2] });
  }
  // 이미지 링크 ![..](..)는 제외 (이미 stripMarkdown 단계에서 빠지지만 raw 검사이므로)
  const ctaLikely = links.filter(l => {
    if (l.url.startsWith('http') || l.url.startsWith('/')) {
      // 이미지 URL은 제외 (jpg/png/webp/gif)
      return !/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(l.url);
    }
    return false;
  });
  const utmTiered = ctaLikely.filter(l => /utm=blog_(top|mid|bottom)/.test(l.url)).length;

  const passed = ctaLikely.length >= 2;
  return {
    gate: 'cta',
    passed,
    reason: passed ? undefined : `CTA·링크 ${ctaLikely.length}개 — 최소 2개 (3-tier 분산) 권장 미달`,
    evidence: {
      total_links: ctaLikely.length,
      utm_tiered: utmTiered,
      sample: ctaLikely.slice(0, 3).map(l => l.url),
    },
  };
}

/**
 * Links 게이트 — 내부링크 ≥1 + 외부 권위 링크 ≥2.
 * 내부링크: yeosonam.com/* 또는 / 시작
 * 외부 권위: 0404.go.kr, gov.kr, mofa.go.kr 등 정부·공기관
 *
 * 외부 링크 2개 이상 기준은 style-guide.ts "외부 권위 링크 규칙"과 동기화.
 */
const MIN_EXTERNAL_LINKS = 2;

export function checkLinks(blog_html: string, baseUrl?: string): GateResult {
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(blog_html)) !== null) {
    if (!/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(m[2])) links.push(m[2]);
  }
  // baseUrl 이 malformed/undefined 일 때 throw 방지
  let baseHost: string | null = null;
  if (baseUrl) {
    try { baseHost = new URL(baseUrl).host; } catch { baseHost = null; }
  }
  const internal = links.filter(u =>
    u.startsWith('/') ||
    (baseHost && u.includes(baseHost)) ||
    u.includes('yeosonam.com'),
  ).length;
  const external = links.filter(u => /^https?:\/\//.test(u) && !(baseHost && u.includes(baseHost))).length;

  const internalOk = internal >= 1;
  const externalOk = external >= MIN_EXTERNAL_LINKS;
  const passed = internalOk && externalOk;
  const reasons: string[] = [];
  if (!internalOk) reasons.push(`내부링크 ${internal}개 — 최소 1개 필요`);
  if (!externalOk) reasons.push(`외부 권위 링크 ${external}개 — 최소 ${MIN_EXTERNAL_LINKS}개 필요 (정부·관광청·공식 사이트)`);

  return {
    gate: 'links',
    passed,
    reason: passed ? undefined : reasons.join(' · '),
    evidence: { internal, external, min_external: MIN_EXTERNAL_LINKS, total: links.length },
  };
}

/**
 * AI-readable Structure 게이트 — Cue / AI Overviews / SGE 인용 최적화.
 *
 * 검증 5축 (criteria, 3개 이상 충족 시 PASS):
 *   1. H2 밀도: info=5~9개, product=3~6개 (인용 가능한 의미 단위)
 *   2. 정의 문단: H1 직후 200자 안에 "~란/~이란/~은/~는 …다" 또는 한 줄 답변형 종결
 *   3. FAQ 블록: "Q.~" / "## 자주 묻는 질문" / "Q:" 패턴 ≥3
 *   4. 질문형 H2: "?" 로 끝나는 H2 ≥1 (검색쿼리 ↔ 헤딩 매칭)
 *   5. 추출 가능 자료: 숫자 리스트 ≥1 OR 테이블 ≥1 OR bullet list ≥2
 *
 * Why: 네이버 Cue / Google AI Overviews 는 짧은 정의 + Q&A + 리스트를 우선 발췌.
 */
export function checkAiReadability(
  blog_html: string,
  blog_type: 'product' | 'info' = 'product',
): GateResult {
  const lines = blog_html.split('\n');

  // 1) H2 밀도
  const h2Lines = lines.filter(l => /^##\s+\S/.test(l.trim()));
  const h2Count = h2Lines.length;
  const h2Range = blog_type === 'info' ? { min: 5, max: 9 } : { min: 3, max: 6 };
  const h2Ok = h2Count >= h2Range.min && h2Count <= h2Range.max;

  // 2) 정의 문단 — H1 다음 200자
  const h1Idx = lines.findIndex(l => /^#\s+\S/.test(l.trim()));
  const intro = stripMarkup(
    lines.slice(h1Idx >= 0 ? h1Idx + 1 : 0).join('\n')
  ).slice(0, 200);
  // "~은/는/이란/란 …다/입니다/이다/이에요" 한 문장형 정의
  const definitionOk = /[가-힣]{2,}(은|는|이란|란)\s.+?(?:다|입니다|이다|이에요|예요)\.?/.test(intro)
    || /^[가-힣A-Za-z0-9]{2,}\s*[—:].+/.test(intro.split('.')[0] || '');

  // 3) FAQ 블록 — Q.~ / Q:~ / "자주 묻는 질문" 헤딩 ≥3 표지
  const faqHeadingRe = /##\s*(자주\s*묻는\s*질문|FAQ|Q\s*&\s*A|자주\s*하는\s*질문)/i;
  const hasFaqHeading = lines.some(l => faqHeadingRe.test(l));
  const qPatterns = (blog_html.match(/(^|\n)\s*(?:[*-]\s*)?Q[\.\:\)]\s*/g) || []).length;
  const qHeadings = lines.filter(l => /^###?\s*Q[\.\:]/i.test(l.trim())).length;
  const faqOk = hasFaqHeading || qPatterns >= 3 || qHeadings >= 3;

  // 4) 질문형 H2
  const questionH2 = h2Lines.filter(l => /[\?？]\s*$/.test(l.trim())).length;
  const questionH2Ok = questionH2 >= 1;

  // 5) 추출 가능 자료
  const numberedList = (blog_html.match(/(^|\n)\s*\d+\.\s+\S/g) || []).length;
  const bulletList = (blog_html.match(/(^|\n)\s*[*-]\s+\S/g) || []).length;
  const tableRow = (blog_html.match(/(^|\n)\s*\|.+\|/g) || []).length;
  // table 은 2행 이상이어야 의미. bullet 은 2개 이상.
  const extractableOk = numberedList >= 1 || tableRow >= 2 || bulletList >= 2;

  const criteria = [
    { key: 'h2_density', ok: h2Ok, h2Count, h2Range },
    { key: 'definition_paragraph', ok: definitionOk, intro_preview: intro.slice(0, 80) },
    { key: 'faq_block', ok: faqOk, qPatterns, qHeadings, hasFaqHeading },
    { key: 'question_h2', ok: questionH2Ok, count: questionH2 },
    { key: 'extractable_assets', ok: extractableOk, numberedList, bulletList, tableRow },
  ];
  const okCount = criteria.filter(c => c.ok).length;
  const passed = okCount >= 3;

  return {
    gate: 'ai_readability',
    passed,
    reason: passed
      ? undefined
      : `AI 인용 최적화 ${okCount}/5 — 통과 기준 3 미달 (실패: ${criteria.filter(c => !c.ok).map(c => c.key).join(', ')})`,
    evidence: { score: okCount, criteria },
  };
}

export async function checkRenderIntegrity(blog_html: string): Promise<GateResult> {
  try {
    const rendered = await renderBlogContentToHtml(blog_html);
    const report = inspectRenderedBlogIntegrity(blog_html, rendered);
    return {
      gate: 'render_integrity',
      passed: report.passed,
      reason: report.reason,
      evidence: report.evidence,
    };
  } catch (error) {
    return {
      gate: 'render_integrity',
      passed: false,
      reason: `본문 렌더링 실패: ${error instanceof Error ? error.message : String(error)}`,
      evidence: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

export async function checkStructureIntegrity(input: CheckInput): Promise<GateResult> {
  try {
    const rendered = await renderBlogContentToHtml(input.blog_html);
    const report = inspectBlogStructure({
      rawMarkdown: input.blog_html,
      renderedHtml: rendered,
      title: input.primary_keyword,
      slug: input.slug,
      angleType: input.angle_type,
      primaryKeyword: input.primary_keyword,
    });
    const issueCodes = report.issues.map((issue) => issue.code);

    return {
      gate: 'structure_integrity',
      passed: report.passed,
      reason: report.passed
        ? undefined
        : `본문 구조 오류 감지: ${[...new Set(issueCodes)].join(', ')}`,
      evidence: {
        score: report.score,
        issueCount: report.issues.length,
        criticalCount: report.issues.filter((issue) => issue.severity === 'critical').length,
        issues: report.issues.slice(0, 10),
      },
    };
  } catch (error) {
    return {
      gate: 'structure_integrity',
      passed: false,
      reason: `본문 구조 감사 실패: ${error instanceof Error ? error.message : String(error)}`,
      evidence: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

function countMatches(value: string, pattern: RegExp): number {
  return (value.match(pattern) || []).length;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function getRenderedParagraphLengths(renderedHtml: string): number[] {
  const matches = [...renderedHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];

  if (matches.length === 0) {
    return renderedHtml
      .split(/\n{2,}/)
      .map((part) => stripHtml(part).length)
      .filter((length) => length > 0);
  }

  return matches
    .map((match) => stripHtml(match[1] || '').length)
    .filter((length) => length > 0);
}

export async function checkAccentDensity(blog_html: string): Promise<GateResult> {
  const renderedHtml = await renderBlogContentToHtml(blog_html);
  const legacyMarkerCount = countMatches(blog_html, /==[^=\n]{1,120}?==/g);
  const markCount = countMatches(`${blog_html}\n${renderedHtml}`, /<mark\b/gi);
  const strongNumCount = Math.max(
    countMatches(blog_html, /<strong\b[^>]*\bclass=["'][^"']*\bnum\b[^"']*["'][^>]*>/gi),
    countMatches(renderedHtml, /<strong\b[^>]*\bclass=["'][^"']*\bnum\b[^"']*["'][^>]*>/gi),
  );
  const h2Count = Math.max(
    countMatches(blog_html, /^\s{0,3}##\s+\S/gm),
    countMatches(renderedHtml, /<h2\b/gi),
  );
  const h3Count = Math.max(
    countMatches(blog_html, /^\s{0,3}###\s+\S/gm),
    countMatches(renderedHtml, /<h3\b/gi),
  );
  const paragraphLengths = getRenderedParagraphLengths(renderedHtml);
  const longestParagraph = Math.max(0, ...paragraphLengths);
  const blockers = [
    markCount > 0 || legacyMarkerCount > 0 ? 'highlight_marker' : null,
    strongNumCount > 35 ? 'numeric_accent_density' : null,
    h2Count > 10 ? 'h2_density' : null,
    h3Count > 20 ? 'h3_density' : null,
    longestParagraph > 450 ? 'long_paragraph' : null,
  ].filter(Boolean);

  return {
    gate: 'accent_density',
    passed: blockers.length === 0,
    reason: blockers.length > 0 ? `visual accent density failed: ${blockers.join(', ')}` : undefined,
    evidence: {
      legacyMarkerCount,
      markCount,
      strongNumCount,
      h2Count,
      h3Count,
      longestParagraph,
    },
  };
}

export function checkImageQuality(input: CheckInput): GateResult {
  const report = inspectBlogImageQuality(input.blog_html, {
    destination: input.destination,
    primaryKeyword: input.primary_keyword,
    blogType: input.blog_type,
  });

  return {
    gate: 'image_quality',
    passed: report.passed,
    reason: report.reason,
    evidence: report.evidence,
  };
}

export function checkIntentQuality(input: CheckInput): GateResult {
  const report = inspectBlogIntentQuality({
    title: input.primary_keyword,
    slug: input.slug,
    primaryKeyword: input.primary_keyword,
    angleType: input.angle_type,
    category: input.category,
    contentType: input.content_type,
    productId: input.product_id ?? (input.blog_type === 'product' ? 'product' : null),
    blogHtml: input.blog_html,
  });

  return {
    gate: 'intent_quality',
    passed: report.passed,
    reason: report.passed
      ? undefined
      : `intent/design quality ${report.score}/100: ${report.issues
          .slice(0, 5)
          .map((issue) => issue.code)
          .join(', ')}`,
    evidence: {
      score: report.score,
      intent: report.intent,
      criticalCount: report.issues.filter((issue) => issue.severity === 'critical').length,
      warningCount: report.issues.filter((issue) => issue.severity === 'warning').length,
      issues: report.issues.slice(0, 12),
    },
  };
}

function checkTopicFit(input: CheckInput): GateResult {
  const report = evaluateBlogTopicFit({
    topic: input.primary_keyword,
    destination: input.destination,
    primaryKeyword: input.primary_keyword,
    angleType: input.angle_type,
    category: input.category,
    contentType: input.content_type,
    productId: input.product_id,
  });

  return {
    gate: 'topic_fit',
    passed: report.passed,
    reason: report.passed
      ? undefined
      : `topic fit ${report.score}/100: ${report.issues
          .filter((issue) => issue.severity === 'critical')
          .slice(0, 5)
          .map((issue) => issue.code)
          .join(', ')}`,
    evidence: {
      score: report.score,
      criticalCount: report.issues.filter((issue) => issue.severity === 'critical').length,
      warningCount: report.issues.filter((issue) => issue.severity === 'warning').length,
      issues: report.issues.slice(0, 12),
    },
  };
}

function checkEditorialQuality(input: CheckInput): GateResult {
  const report = evaluateBlogEditorialQuality({
    slug: input.slug,
    topic: input.primary_keyword,
    destination: input.destination,
    primaryKeyword: input.primary_keyword,
    angleType: input.angle_type,
    category: input.category,
    contentType: input.content_type,
    productId: input.product_id,
    blogHtml: input.blog_html,
  });

  return {
    gate: 'editorial_quality',
    passed: report.passed,
    reason: report.passed
      ? undefined
      : `editorial quality ${report.score}/100: ${report.issues
          .filter((issue) => issue.severity === 'critical')
          .slice(0, 5)
          .map((issue) => issue.code)
          .join(', ')}`,
    evidence: {
      score: report.score,
      criticalCount: report.issues.filter((issue) => issue.severity === 'critical').length,
      warningCount: report.issues.filter((issue) => issue.severity === 'warning').length,
      issues: report.issues.slice(0, 12),
    },
  };
}

export async function checkDuplicate(input: CheckInput): Promise<GateResult> {
  const since = new Date();
  since.setDate(since.getDate() - DEDUP_WINDOW_DAYS);
  const sinceIso = since.toISOString();

  // 1) slug 정확 일치 중복
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

  // 1b) slug prefix 기반 fuzzy 중복 — slugify 전 토픽 유사도
  // "태국-입국-서류-정리"와 "태국-입국-서류-총정리-재작성-v2"가 slug는 다르지만 같은 주제
  const slugPrefix = input.skipFuzzyDuplicate ? null : getSpecificSlugPrefix(input.slug);
  if (slugPrefix) {
    // 순수 영문 prefix만 Postgres 문자열 범위 검색 (한글 포함 시 정렬이 다름)
    const prefixQuery = supabaseAdmin
      .from('content_creatives')
      .select('id, slug')
      .eq('channel', 'naver_blog')
      .in('status', ['published', 'scheduled', 'draft'])
      .gte('slug', slugPrefix)
      .lt('slug', slugPrefix + '~'); // 문자열 범위 검색

    if (input.excludeContentCreativeId) {
      prefixQuery.neq('id', input.excludeContentCreativeId);
    }

    const { data: prefixDupes } = await prefixQuery.limit(1);

    if (prefixDupes && prefixDupes.length > 0) {
      return {
        gate: 'duplicate',
        passed: false,
        reason: `유사 slug 존재: ${prefixDupes[0].slug} (prefix: ${slugPrefix})`,
        evidence: { type: 'slug_prefix', existing_slug: prefixDupes[0].slug },
      };
    }
  }

  // 2) (destination + angle_type) 14일 내 중복 — travel_packages JOIN + content_creatives.destination 둘 다 확인
  if (shouldCheckDestinationAngleDuplicate(input)) {
    // 2a) travel_packages JOIN 경로 (상품 블로그)
    const angleQuery = supabaseAdmin
      .from('content_creatives')
      .select('id, slug, travel_packages!inner(destination)')
      .eq('angle_type', input.angle_type)
      .eq('travel_packages.destination', input.destination)
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .gte('published_at', sinceIso);

    if (input.excludeContentCreativeId) {
      angleQuery.neq('id', input.excludeContentCreativeId);
    }

    const { data: angleDupes } = await angleQuery.limit(1);

    if (angleDupes && angleDupes.length > 0) {
      return {
        gate: 'duplicate',
        passed: false,
        reason: `최근 ${DEDUP_WINDOW_DAYS}일 내 ${input.destination} + ${input.angle_type} 이미 발행됨`,
        evidence: { type: 'destination_angle', existing_slug: angleDupes[0].slug },
      };
    }

    // 2b) 정보성 글(product_id=null)을 위한 content_creatives.destination 직접 비교
    const infoQuery = supabaseAdmin
      .from('content_creatives')
      .select('id, slug')
      .eq('angle_type', input.angle_type)
      .eq('destination', input.destination)
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .is('product_id', null) // 정보성 글만
      .gte('published_at', sinceIso);

    if (input.excludeContentCreativeId) {
      infoQuery.neq('id', input.excludeContentCreativeId);
    }

    const { data: infoDupes } = await infoQuery.limit(1);

    if (infoDupes && infoDupes.length > 0) {
      return {
        gate: 'duplicate',
        passed: false,
        reason: `최근 ${DEDUP_WINDOW_DAYS}일 내 ${input.destination} + ${input.angle_type} 정보성 글 이미 발행됨`,
        evidence: { type: 'destination_angle_info', existing_slug: infoDupes[0].slug },
      };
    }
  }

  return { gate: 'duplicate', passed: true };
}

export async function runQualityGates(input: CheckInput): Promise<QualityGateReport> {
  const blogType = input.blog_type ?? 'info';
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
  const gates: GateResult[] = [];

  // 동적 임계값 로드 (blog-bayesian-optimizer 에서 주간/월간 자동 조정)
  let adaptive: AdaptiveThresholds | null = null;
  try {
    adaptive = await getActiveThresholds();
  } catch {
    // fallback: 기본 THRESHOLDS 상수 사용
  }

  gates.push(checkLength(input.blog_html, blogType));
  gates.push(checkCliche(input.blog_html, blogType));
  gates.push(await checkDuplicate(input));
  gates.push(checkKeywordDensity(input.blog_html, input.primary_keyword, blogType));
  gates.push(checkHook(input.blog_html));
  gates.push(checkCta(input.blog_html));
  gates.push(checkLinks(input.blog_html, baseUrl));
  // 가독성 게이트 — 동적 임계값 적용
  const readThreshold = blogType === 'info'
    ? (adaptive?.infoMinReadability ?? 70)
    : (adaptive?.productMinReadability ?? 60);
  gates.push(checkReadability(input.blog_html, readThreshold));
  // AI 인용 최적화 (Cue/AIO/SGE) — 9번째 게이트
  gates.push(checkAiReadability(input.blog_html, blogType));
  // 실제 상세 페이지 렌더 기준 검증 — 이미지/링크/헤딩 마크다운 잔여물 차단
  gates.push(await checkRenderIntegrity(input.blog_html));
  // 의미 구조 검증 — 테이블 문단 오염, 원시 :::, 중복 FAQ/요약, 무너진 체크리스트 차단
  gates.push(await checkStructureIntegrity(input));
  gates.push(await checkAccentDensity(input.blog_html));
  gates.push(checkTopicFit(input));
  // 글 의도 계약 검증 — 정보/상품/날씨/준비물/일정별 필수 블록과 읽기 디자인 차단
  gates.push(checkIntentQuality(input));
  gates.push(checkEditorialQuality(input));
  // 이미지 품질 기준 검증 — 깨진 URL, 중복, 빈 alt, 주제 무관 alt/caption 차단
  gates.push(checkImageQuality(input));

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
