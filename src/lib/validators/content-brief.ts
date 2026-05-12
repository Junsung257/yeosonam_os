import { z } from 'zod';
import { TEMPLATE_IDS } from '@/lib/card-news/tokens';

/**
 * ContentBrief 스키마 — 블로그+카드뉴스 통합 설계도 (V2 확장)
 *
 * V1: sections[i].card_slide.{headline, body, pexels_keyword, template_suggestion, badge}
 * V2: 추가 슬롯 — eyebrow/tip/warning/price_chip/trust_row/accent_color/photo_hint
 *     LLM이 의미 있는 슬롯으로 카피를 뱉으면, briefToSlides()가 family 별로 합성.
 *
 * Call 1 (Brief 설계자)의 출력이 이 스키마를 통과해야 Call 2/3이 실행됨.
 * V2 슬롯은 모두 optional — 기존 LLM 응답도 호환.
 */

export const SlideRoleEnum = z.enum([
  'hook',         // 1번 슬라이드 (후킹/표지)
  'benefit',      // 핵심 혜택
  'detail',       // 상세 정보
  'tip',          // 꿀팁
  'warning',      // 주의점/실수 유형
  'tourist_spot', // 관광지 소개 (product 모드)
  'inclusion',    // 포함 사항
  'objection',    // V4: 반론 예측+해소 ("노옵션인데 추가금?", "너무 싸서 불안" → 약관 근거로 방어)
  'save_hook',    // V4: 저장 유도 체크리스트 ("저장해두고 보는 O가지") — 뒤에서 두 번째 슬라이드 기본값
  'cta',          // 마지막 슬라이드 (예약 유도)
]);

export const ContentModeEnum = z.enum(['product', 'info']);

export const TemplateFamilyEnum = z.enum(['editorial', 'cinematic', 'premium', 'bold']);

/**
 * V3: 5가지 Hook 유형 — PostNitro AIDA + 토스 CTR 공식 + 여행업 케이스 종합
 *   urgency    : [선착순 N석] / [오늘만]        → 특가/마감
 *   question   : 보홀 3박, 진짜 얼마?          → 가성비/정보성
 *   number     : 다낭 4박 7가지 꿀팁            → 정보성 가이드
 *   fomo       : 이번 주 사라지는 특가 TOP 3     → 재고 한정
 *   story      : 작년 보홀 갔다 눈물흘린 이유    → 프리미엄/신혼
 *   contrarian : V4 — 통념 파괴 ("보홀은 비싸다는 거짓말")  → 글로벌 캐러셀 Hook Top 5
 */
export const HookTypeEnum = z.enum(['urgency', 'question', 'number', 'fomo', 'story', 'contrarian']);

/** V2: 슬라이드 단위 구조화 슬롯 */
export const CardSlideV2Schema = z.object({
  // V1 (필수)
  headline: z.string().min(2).max(20),
  body: z.string().min(2).max(50),
  template_suggestion: z.enum(TEMPLATE_IDS),
  pexels_keyword: z.string().min(2).max(40),
  badge: z.string().max(10).optional().nullable(),
  // V2 (선택)
  eyebrow: z.string().max(20).optional().nullable(),
  tip: z.string().max(80).optional().nullable(),
  warning: z.string().max(80).optional().nullable(),
  price_chip: z.string().max(20).optional().nullable(),
  trust_row: z.array(z.string().max(12)).max(4).optional().nullable(),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  photo_hint: z.string().max(100).optional().nullable(),
  // V3 (선택)
  hook_type: HookTypeEnum.optional().nullable(),           // hook 섹션일 때만 의미
  social_proof: z.string().max(40).optional().nullable(),  // "별점 4.9 · 예약 50건" 같이 증거 수치
});

export const BriefSectionSchema = z.object({
  position: z.number().int().min(1),
  h2: z.string().min(2).max(50),
  role: SlideRoleEnum,
  blog_paragraph_seed: z.string().min(10).max(500),
  card_slide: CardSlideV2Schema,
});

export const ContentBriefSchema = z.object({
  mode: ContentModeEnum,
  h1: z.string().min(5).max(80),
  intro_hook: z.string().min(10).max(200),
  target_audience: z.string().min(5).max(100),
  key_selling_points: z.array(z.string().min(2).max(60)).min(2).max(5),
  sections: z.array(BriefSectionSchema).min(3).max(8),
  cta_slide: CardSlideV2Schema,
  seo: z.object({
    title: z.string().min(10).max(70),
    description: z.string().min(30).max(200),
    slug_suggestion: z.string().min(3).max(100),
  }),
  // V2: 템플릿 family 제안 (LLM이 상품/주제 성격에 맞게 추천)
  template_family_suggestion: TemplateFamilyEnum.optional(),
});

export type ContentBrief = z.infer<typeof ContentBriefSchema>;
export type BriefSection = z.infer<typeof BriefSectionSchema>;
export type SlideRole = z.infer<typeof SlideRoleEnum>;
export type TemplateFamily = z.infer<typeof TemplateFamilyEnum>;
export type CardSlideV2 = z.infer<typeof CardSlideV2Schema>;
export type HookType = z.infer<typeof HookTypeEnum>;

/**
 * Brief 파싱 + 복구 시도
 * AI 응답(text) → ContentBrief 검증 통과된 객체 OR null
 */
export function parseAndValidateBrief(rawText: string): { data: ContentBrief | null; errors: string[] } {
  const errors: string[] = [];

  // 1차: 마크다운 코드블록 제거
  let text = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  // 2차: JSON 객체 추출 시도
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) text = jsonMatch[0];

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    errors.push(`JSON parse 실패: ${err instanceof Error ? err.message : String(err)}`);
    // trailing comma 복구 시도
    try {
      const cleaned = text.replace(/,\s*([}\]])/g, '$1');
      parsed = JSON.parse(cleaned);
    } catch (err2) {
      errors.push(`복구 후 재파싱도 실패: ${err2 instanceof Error ? err2.message : String(err2)}`);
      return { data: null, errors };
    }
  }

  const result = ContentBriefSchema.safeParse(parsed);
  if (!result.success) {
    errors.push(...result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`));
    return { data: null, errors };
  }

  return { data: result.data, errors: [] };
}
