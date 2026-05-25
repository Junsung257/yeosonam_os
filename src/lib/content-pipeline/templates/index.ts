/**
 * 블로그 H2 구조 템플릿 레지스트리
 *
 * 검색 의도(intent)에 따라 적절한 템플릿을 선택하여
 * 콘텐츠 다양화를 실현한다.
 */

import { ContentBrief, BriefSection } from '@/lib/validators/content-brief';
import { pillarTemplate } from './pillar';
import { listTemplate } from './list';
import { comparisonTemplate } from './comparison';
import { guideTemplate } from './guide';
import { qaTemplate } from './qa';
import { productReviewTemplate } from './product-review';

// ── 타입 정의 ───────────────────────────────────────────────

export interface TemplateSection {
  h2: string;
  prompt: string;
  minWords?: number;
}

export type SearchIntent = 'informational' | 'commercial' | 'transactional' | 'navigational';

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  intentPatterns: RegExp[];
  /** 키워드를 받아 TemplateSection[] 생성 (brief 없이도 독립 테스트 가능) */
  buildSections(keyword: string): TemplateSection[];
}

// ── 레지스트리 ───────────────────────────────────────────────

const templates: TemplateDefinition[] = [
  pillarTemplate,
  listTemplate,
  comparisonTemplate,
  guideTemplate,
  qaTemplate,
  productReviewTemplate,
];

/**
 * 키워드에 가장 적합한 템플릿 선택
 *
 * 다음 3가지 차원을 종합 평가:
 *   1. intentPatterns RegExp 매칭 (가중치 10)
 *   2. 키워드 길이 (가중치 3) — 긴 키워드=비교/가이드, 짧은=기둥
 *   3. conflictScore (가중치 5) — 특정 템플릿에 강하게 속하면 우대
 */
export function selectTemplate(keyword: string): TemplateDefinition {
  let best = pillarTemplate;
  let bestScore = 0;

  for (const tpl of templates) {
    let score = 0;

    // 1) intent 패턴 매칭 (기존)
    for (const pattern of tpl.intentPatterns) {
      if (pattern.test(keyword)) {
        score += 10;
      }
    }

    // 2) 키워드 길이 (3~6단어는 복합 의도 → comparison/guide 우대)
    const wordCount = keyword.split(/\s+/).filter(Boolean).length;
    if ((tpl.id === 'comparison' || tpl.id === 'guide') && wordCount >= 4) {
      score += 3;
    }
    if (tpl.id === 'pillar' && wordCount <= 2) {
      score += 3;
    }

    // 3) conflictScore: 'vs' '차이' '비교' → comparison, '방법' 'tip' → guide
    if (tpl.id === 'comparison' && /\b(vs|차이|비교|대비|선택)\b/.test(keyword)) {
      score += 5;
    }
    if (tpl.id === 'guide' && /\b(방법|tip|꿀팁|가이드|준비|순서)\b/.test(keyword)) {
      score += 5;
    }
    if (tpl.id === 'qa' && /\b(왜|어떻게|무엇|할까|질문|q&a|faq)\b/.test(keyword)) {
      score += 5;
    }
    if (tpl.id === 'product-review' && /\b(리뷰|후기|추천|가격|비용|사용)\b/.test(keyword)) {
      score += 5;
    }

    if (score > bestScore) {
      bestScore = score;
      best = tpl;
    }
  }

  return best;
}

/**
 * 선택된 템플릿으로부터 ContentBrief.sections 변환
 *
 * 기존 brief의 sections 구조를 템플릿이 생성한 section 구조로 대체.
 * seo, intro_hook 등 메타 정보는 유지.
 */
export function applyTemplateToBrief(
  brief: ContentBrief,
  template: TemplateDefinition,
  keyword: string,
): ContentBrief {
  const templateSections = template.buildSections(keyword);

  // sections 변환
  const newSections: BriefSection[] = templateSections.map((ts, idx) => ({
    position: idx + 1,
    h2: ts.h2,
    role: idx === templateSections.length - 1 ? 'cta' : idx === 0 ? 'benefit' : 'detail',
    blog_paragraph_seed: ts.prompt,
              card_slide: {
                  headline: ts.h2.slice(0, 20),
                  body: ts.prompt.slice(0, 50),
                  template_suggestion: 'clean_white' as const,
                  pexels_keyword: keyword,
                },
  }));

  return {
    ...brief,
    sections: newSections,
  };
}

export {
  pillarTemplate,
  listTemplate,
  comparisonTemplate,
  guideTemplate,
  qaTemplate,
  productReviewTemplate,
};

export default templates;
