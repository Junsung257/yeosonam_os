/**
 * briefToSlides — ContentBrief(V2) → SlideV2[]
 *
 * 철학: LLM은 brief만 뱉고, family 선택과 레이아웃 조합은 결정적 함수가 담당.
 *       같은 brief로 다른 family를 골라 재렌더할 수 있어야 한다.
 */
import type { ContentBrief, TemplateFamily } from '@/lib/validators/content-brief';
import type { SlideV2 } from './types';

export interface BriefToSlidesOptions {
  family?: TemplateFamily;     // 명시적 지정 (없으면 brief.template_family_suggestion 또는 'editorial')
  version?: string;             // 템플릿 버전 (기본 'v2')
}

export function briefToSlides(
  brief: ContentBrief,
  options: BriefToSlidesOptions = {},
): SlideV2[] {
  const family: TemplateFamily =
    options.family ?? brief.template_family_suggestion ?? 'editorial';
  const version = options.version ?? 'v2';

  const slides: SlideV2[] = [];

  // sections → detail/tip/warning slides
  for (let i = 0; i < brief.sections.length; i++) {
    const s = brief.sections[i];
    const cs = s.card_slide;
    slides.push({
      id: `slide-${Date.now()}-${i + 1}`,
      position: i,   // 0-based
      role: s.role,
      template_family: family,
      template_version: version,
      headline: cs.headline,
      body: cs.body,
      eyebrow: cs.eyebrow ?? null,
      tip: cs.tip ?? null,
      warning: cs.warning ?? null,
      price_chip: cs.price_chip ?? null,
      trust_row: cs.trust_row ?? null,
      badge: cs.badge ?? null,
      accent_color: cs.accent_color ?? null,
      photo_hint: cs.photo_hint ?? null,
      pexels_keyword: cs.pexels_keyword,
      brief_section_position: s.position,
    });
  }

  // CTA slide
  const cta = brief.cta_slide;
  slides.push({
    id: `slide-${Date.now()}-cta`,
    position: slides.length,
    role: 'cta',
    template_family: family,
    template_version: version,
    headline: cta.headline,
    body: cta.body,
    eyebrow: cta.eyebrow ?? null,
    tip: cta.tip ?? null,
    warning: cta.warning ?? null,
    price_chip: cta.price_chip ?? null,
    trust_row: cta.trust_row ?? null,
    badge: cta.badge ?? '지금 예약하기',
    accent_color: cta.accent_color ?? null,
    photo_hint: cta.photo_hint ?? null,
    pexels_keyword: cta.pexels_keyword,
  });

  return slides;
}
