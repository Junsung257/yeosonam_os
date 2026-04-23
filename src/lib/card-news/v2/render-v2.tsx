/**
 * V2 카드뉴스 렌더러 — 단일 렌더 경로 (브라우저 + Satori 서버 공통)
 *
 * 출력 JSX는 Satori-safe (display:flex 명시, 인라인 style만) + 브라우저 DOM에서도 동일 렌더.
 * Satori 와 브라우저가 같은 트리를 받으므로 "미리보기와 다운로드가 다르다" 영구 해소.
 */
import React from 'react';
import { EditorialFamily } from './families/editorial';
import { CinematicFamily } from './families/cinematic';
import { PremiumFamily } from './families/premium';
import { BoldFamily } from './families/bold';
import { roleToVariant } from './types';
import type { FamilyRegistry, FormatSpec, SlideV2 } from './types';
import type { TemplateFamily } from '@/lib/validators/content-brief';
import { FORMATS } from './types';

const FAMILIES: Record<TemplateFamily, FamilyRegistry> = {
  editorial: EditorialFamily,
  cinematic: CinematicFamily,
  premium: PremiumFamily,
  bold: BoldFamily,
};

export function getFamily(family: TemplateFamily | undefined): FamilyRegistry {
  return FAMILIES[family ?? 'editorial'] ?? EditorialFamily;
}

export function listFamilies(): TemplateFamily[] {
  return Object.keys(FAMILIES) as TemplateFamily[];
}

export interface RenderSlideInput {
  slide: SlideV2;
  format: FormatSpec;
  pageIndex: number;    // 1-based
  totalPages: number;
}

/** 단일 슬라이드 → React Element (Satori / 브라우저 공용) */
export function renderSlideV2(input: RenderSlideInput): JSX.Element {
  const family = getFamily(input.slide.template_family);
  const variant = roleToVariant(input.slide.role, input.pageIndex - 1, input.totalPages);
  const Variant = family.variants[variant];
  return (
    <Variant
      slide={input.slide}
      format={input.format}
      pageIndex={input.pageIndex}
      totalPages={input.totalPages}
    />
  );
}

export { FORMATS };
