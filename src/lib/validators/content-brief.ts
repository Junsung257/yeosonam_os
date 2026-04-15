import { z } from 'zod';
import { TEMPLATE_IDS } from '@/lib/card-news/tokens';

/**
 * ContentBrief 스키마 — 블로그+카드뉴스 통합 설계도
 *
 * Call 1 (Brief 설계자)의 출력이 이 스키마를 통과해야 Call 2/3이 실행됨.
 * 실패 시 1회 재호출, 그래도 실패하면 fallback 사용.
 */

export const SlideRoleEnum = z.enum([
  'hook',         // 1번 슬라이드 (후킹/표지)
  'benefit',      // 핵심 혜택
  'detail',       // 상세 정보
  'tourist_spot', // 관광지 소개 (product 모드)
  'inclusion',    // 포함 사항
  'cta',          // 마지막 슬라이드 (예약 유도)
]);

export const ContentModeEnum = z.enum(['product', 'info']);

export const BriefSectionSchema = z.object({
  position: z.number().int().min(1),
  h2: z.string().min(2).max(50),
  role: SlideRoleEnum,
  blog_paragraph_seed: z.string().min(10).max(500),
  card_slide: z.object({
    headline: z.string().min(2).max(20),  // 15자 권장 + 안전 마진 5
    body: z.string().min(2).max(50),       // 40자 권장 + 안전 마진 10
    template_suggestion: z.enum(TEMPLATE_IDS),
    pexels_keyword: z.string().min(2).max(40),  // 영문 명사 1~2개
    badge: z.string().max(10).optional().nullable(),
  }),
});

export const ContentBriefSchema = z.object({
  mode: ContentModeEnum,
  h1: z.string().min(5).max(80),
  intro_hook: z.string().min(10).max(200),
  target_audience: z.string().min(5).max(100),  // 필수 — 톤앤매너 일관성
  key_selling_points: z.array(z.string().min(2).max(60)).min(2).max(5),
  sections: z.array(BriefSectionSchema).min(3).max(8),
  cta_slide: z.object({
    headline: z.string().min(2).max(20),
    body: z.string().min(2).max(50),
    template_suggestion: z.enum(TEMPLATE_IDS),
    pexels_keyword: z.string().min(2).max(40),
  }),
  seo: z.object({
    title: z.string().min(10).max(70),
    description: z.string().min(30).max(200),
    slug_suggestion: z.string().min(3).max(100),
  }),
});

export type ContentBrief = z.infer<typeof ContentBriefSchema>;
export type BriefSection = z.infer<typeof BriefSectionSchema>;
export type SlideRole = z.infer<typeof SlideRoleEnum>;

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
