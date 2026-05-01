import { ContentBrief } from '@/lib/validators/content-brief';
import { TEMPLATE_IDS, truncateHeadline, truncateBody } from '@/lib/card-news/tokens';
import { generateBlogJSON, hasBlogApiKey } from '@/lib/blog-ai-caller';

/**
 * Call 2: 카드뉴스 카피라이터
 *
 * 역할: Brief.sections 각각의 card_slide를 정제 (글자 수 엄격 준수)
 * 출력: 최종 슬라이드 배열 (headline ≤15자, body ≤40자 강제)
 */

export interface CardSlideCopy {
  position: number;
  headline: string;
  body: string;
  pexels_keyword: string;
  template_id: string;
  role: string;
  badge?: string | null;
  // V2 슬롯
  eyebrow?: string | null;
  tip?: string | null;
  warning?: string | null;
  price_chip?: string | null;
  trust_row?: string[] | null;
  accent_color?: string | null;
  photo_hint?: string | null;
  // V3 슬롯 (Hook Type + Social Proof)
  hook_type?: string | null;
  social_proof?: string | null;
}

/**
 * Brief를 받아 카드뉴스 슬라이드 카피를 정제
 *
 * 전략:
 * 1. Brief의 card_slide를 기본값으로 사용
 * 2. 글자 수 초과 항목이 있으면 Gemini에게 해당 항목만 다시 짧게 써달라고 요청
 * 3. 그래도 초과 시 강제 truncate (…) + 로그 경고
 */
export async function generateCardCopy(brief: ContentBrief): Promise<CardSlideCopy[]> {
  const rawSlides: CardSlideCopy[] = [
    // sections
    ...brief.sections.map((s) => ({
      position: s.position,
      headline: s.card_slide.headline,
      body: s.card_slide.body,
      pexels_keyword: s.card_slide.pexels_keyword,
      template_id: s.card_slide.template_suggestion,
      role: s.role,
      badge: s.card_slide.badge ?? null,
      eyebrow: s.card_slide.eyebrow ?? null,
      tip: s.card_slide.tip ?? null,
      warning: s.card_slide.warning ?? null,
      price_chip: s.card_slide.price_chip ?? null,
      trust_row: s.card_slide.trust_row ?? null,
      accent_color: s.card_slide.accent_color ?? null,
      photo_hint: s.card_slide.photo_hint ?? null,
      hook_type: s.card_slide.hook_type ?? null,
      social_proof: s.card_slide.social_proof ?? null,
    })),
    // cta slide (마지막)
    {
      position: brief.sections.length + 1,
      headline: brief.cta_slide.headline,
      body: brief.cta_slide.body,
      pexels_keyword: brief.cta_slide.pexels_keyword,
      template_id: brief.cta_slide.template_suggestion,
      role: 'cta',
      badge: brief.cta_slide.badge ?? null,
      eyebrow: brief.cta_slide.eyebrow ?? null,
      tip: brief.cta_slide.tip ?? null,
      warning: brief.cta_slide.warning ?? null,
      price_chip: brief.cta_slide.price_chip ?? null,
      trust_row: brief.cta_slide.trust_row ?? null,
      accent_color: brief.cta_slide.accent_color ?? null,
      photo_hint: brief.cta_slide.photo_hint ?? null,
      hook_type: brief.cta_slide.hook_type ?? null,
      social_proof: brief.cta_slide.social_proof ?? null,
    },
  ];

  // 글자 수 초과 항목 찾기
  const overflowItems = rawSlides.filter(
    s => s.headline.length > 15 || s.body.length > 40
  );

  // 초과 있으면 AI에게 재작성 요청 (해당 항목만)
  if (overflowItems.length > 0 && hasBlogApiKey()) {
    try {
      const prompt = `다음 카드뉴스 슬라이드들의 headline과 body가 글자 수 제한을 초과한다. 의미를 유지하면서 더 짧게 다시 써라.

## 엄격 규칙
- headline: **정확히 15자 이하** (한글/숫자/공백 모두 카운트)
- body: **정확히 40자 이하**
- 브랜드 여소남, 타겟 "${brief.target_audience}" 톤 유지
- JSON만 출력

## 재작성 대상
${JSON.stringify(overflowItems.map(s => ({
  position: s.position,
  current_headline: s.headline,
  current_body: s.body,
  role: s.role,
})), null, 2)}

## 출력 형식 (JSON 배열)
[
  { "position": 1, "headline": "짧은 제목", "body": "짧은 본문" },
  ...
]

반드시 입력된 position만 포함하고, headline/body만 반환하라.`;

      const text = (await generateBlogJSON(prompt, { temperature: 0.3 }))
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

      let fixes: Array<{ position: number; headline: string; body: string }> = [];
      try {
        fixes = JSON.parse(text);
      } catch {
        const arrMatch = text.match(/\[[\s\S]*\]/);
        if (arrMatch) {
          try { fixes = JSON.parse(arrMatch[0]); } catch { /* noop */ }
        }
      }

      // 적용
      if (Array.isArray(fixes)) {
        for (const fix of fixes) {
          const slide = rawSlides.find(s => s.position === fix.position);
          if (slide && fix.headline && fix.body) {
            slide.headline = fix.headline;
            slide.body = fix.body;
          }
        }
      }
    } catch (err) {
      console.warn('[card-copy] 재작성 실패, 강제 truncate 사용:', err instanceof Error ? err.message : err);
    }
  }

  // 최종 안전망: 여전히 초과면 강제 truncate
  return rawSlides.map(s => ({
    ...s,
    headline: truncateHeadline(s.headline, 20),  // 20자 넘으면 …로 잘라냄
    body: truncateBody(s.body, 50),
    template_id: TEMPLATE_IDS.includes(s.template_id as any) ? s.template_id : TEMPLATE_IDS[0],
  }));
}
