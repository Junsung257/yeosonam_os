/**
 * 카드뉴스 V2 공통 타입
 */
import React from 'react';
import { TemplateFamily } from '@/lib/validators/content-brief';

export type FormatKey = '1x1' | '4x5' | '9x16' | 'blog';

export interface FormatSpec {
  key: FormatKey;
  w: number;
  h: number;
  label: string;
  safeInset: number;  // 상하 safe zone (픽셀)
}

export const FORMATS: Record<FormatKey, FormatSpec> = {
  '1x1': { key: '1x1', w: 1080, h: 1080, label: 'Instagram 피드 (1:1)', safeInset: 40 },
  '4x5': { key: '4x5', w: 1080, h: 1350, label: 'Instagram 피드 (4:5)', safeInset: 50 },
  '9x16': { key: '9x16', w: 1080, h: 1920, label: 'Instagram 릴스/스토리 (9:16)', safeInset: 80 },
  blog:   { key: 'blog', w: 1200, h: 675, label: '블로그 인라인 (16:9)', safeInset: 30 },
};

export type VariantKey = 'cover' | 'detail' | 'tip' | 'warning' | 'cta';

/** role → variant 자동 매핑 */
export function roleToVariant(role: string | undefined, positionIndex: number, totalSlides: number): VariantKey {
  if (role === 'hook' || positionIndex === 0) return 'cover';
  if (role === 'cta' || positionIndex === totalSlides - 1) return 'cta';
  if (role === 'tip') return 'tip';
  if (role === 'warning') return 'warning';
  return 'detail';
}

/** Slide V2 — DB에 저장되는 슬라이드 단위 */
export interface SlideV2 {
  id: string;
  position: number;
  role?: string;
  template_family?: TemplateFamily;
  template_version?: string;

  // 텍스트 슬롯
  headline: string;
  body: string;
  eyebrow?: string | null;
  tip?: string | null;
  warning?: string | null;
  price_chip?: string | null;
  trust_row?: string[] | null;

  // 시각 슬롯
  bg_image_url?: string;
  pexels_keyword?: string;
  badge?: string | null;
  accent_color?: string | null;
  photo_hint?: string | null;

  // V3 슬롯 (Hook Type + Social Proof)
  hook_type?: 'urgency' | 'question' | 'number' | 'fomo' | 'story' | null;
  social_proof?: string | null;

  // 메타
  brief_section_position?: number;
}

/** 템플릿 variant 컴포넌트의 공통 props */
export interface VariantProps {
  slide: SlideV2;
  format: FormatSpec;
  pageIndex: number;
  totalPages: number;
}

/** Family registry 항목 */
export interface FamilyRegistry {
  family: TemplateFamily;
  variants: Record<VariantKey, React.FC<VariantProps>>;
}
