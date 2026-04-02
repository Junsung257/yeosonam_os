/**
 * ══════════════════════════════════════════════════════════
 * Card News V2 — 멀티레이어 슬라이드 타입 시스템
 * ══════════════════════════════════════════════════════════
 * Mirra AI 수준의 카드뉴스를 위한 V2 데이터 모델.
 * - 슬라이드당 다수의 텍스트 레이어 (서브타이틀, 타이틀, 배지, 핸들 등)
 * - 디자인 요소 (pill 배지, 그라데이션 박스 등)
 * - 이미지 초점/확대 제어
 * - 기존 V1(headline/body) 하위 호환
 */

// ── 텍스트 레이어 ──────────────────────────────────────────

export type TextRole = 'subtitle' | 'title' | 'body' | 'badge' | 'handle' | 'page-number' | 'price' | 'cta-button' | 'brand' | 'custom';

export interface TextLayer {
  id: string;
  role: TextRole;
  content: string;
  // 위치 (% 기반, 0-100)
  x: number;
  y: number;
  width: number;
  height: number;
  // 타이포그래피
  fontFamily: string;
  fontSize: number;
  fontWeight: string;    // 'normal' | 'bold' | '100'-'900'
  color: string;
  textAlign: 'left' | 'center' | 'right';
  lineHeight?: number;   // 예: 1.3
  letterSpacing?: number; // px 단위
  opacity?: number;       // 0-1
  textTransform?: 'none' | 'uppercase' | 'lowercase';
}

// ── 디자인 요소 ────────────────────────────────────────────

export type ElementType = 'rectangle' | 'circle' | 'line' | 'pill-badge' | 'gradient-box';

export interface DesignElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  opacity?: number;
  gradient?: string;  // CSS gradient 문자열
}

// ── 이미지 설정 ────────────────────────────────────────────

export interface ImageSettings {
  url: string;
  pexelsKeyword?: string;
  focusX: number;     // 0-100 (object-position %)
  focusY: number;     // 0-100
  zoom: number;       // 1.0 = fit, 1.5 = 150%
  brightness?: number; // 0.5 - 1.5 (기본 1.0)
}

// ── 오버레이 설정 ──────────────────────────────────────────

export type OverlayType = 'solid' | 'gradient-bottom' | 'gradient-top' | 'gradient-center' | 'gradient-diagonal';

export interface OverlaySettings {
  type: OverlayType;
  color: string;
  opacity: number;       // 0-100
  secondaryColor?: string;
}

// ── V2 슬라이드 ────────────────────────────────────────────

export type SlideRole = 'cover' | 'content' | 'detail' | 'cta';

export interface CardNewsSlideV2 {
  id: string;
  position: number;
  templateId: string;
  slideRole: SlideRole;

  // 이미지
  image: ImageSettings;

  // 오버레이
  overlay: OverlaySettings;

  // 텍스트 레이어 (z-index 순서)
  textLayers: TextLayer[];

  // 디자인 요소
  designElements: DesignElement[];

  // 슬라이드 배경 (이미지 없을 때 fallback)
  backgroundColor?: string;
  backgroundGradient?: string;

  // V1 호환 필드 (마이그레이션 완료 후에도 유지)
  headline?: string;
  body?: string;
  bg_image_url?: string;
  overlay_style?: string;
  pexels_keyword?: string;
}

// ── V2 CardNews ────────────────────────────────────────────

export interface CardNewsV2 {
  id: string;
  package_id: string | null;
  campaign_id: string | null;
  title: string;
  status: 'DRAFT' | 'CONFIRMED' | 'LAUNCHED' | 'ARCHIVED';
  template_id: string;
  slides: CardNewsSlideV2[];
  meta_creative_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // 위저드 메타데이터
  generation_config?: {
    tone: string;
    angle?: string;
    extraPrompt?: string;
    slideCount: number;
    ratio: string;
  };
  // 조인 필드
  package_title?: string;
  package_destination?: string;
}

// ── 템플릿 정의 타입 ───────────────────────────────────────

export interface TemplateSlotDef {
  role: TextRole;
  label: string;           // UI 표시명 (예: "서브 타이틀")
  defaultContent: string;
  x: number; y: number; width: number; height: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  color: string;
  textAlign: 'left' | 'center' | 'right';
  lineHeight?: number;
  letterSpacing?: number;
  opacity?: number;
  textTransform?: 'none' | 'uppercase' | 'lowercase';
}

export interface TemplateDesignElementDef {
  type: ElementType;
  x: number; y: number; width: number; height: number;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  opacity?: number;
  gradient?: string;
}

export interface TemplateLayoutDef {
  textSlots: TemplateSlotDef[];
  designElements: TemplateDesignElementDef[];
  overlay: OverlaySettings;
}

export type TemplateCategory = 'travel-cover' | 'travel-detail' | 'travel-cta' | 'info-list' | 'general';

export interface CardNewsTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  previewColor: string;

  // 슬라이드 역할별 레이아웃
  coverLayout: TemplateLayoutDef;
  contentLayout: TemplateLayoutDef;
  ctaLayout: TemplateLayoutDef;

  // 색상 스킴
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    textPrimary: string;
    textSecondary: string;
    badgeBg: string;
    badgeBorder: string;
    badgeText: string;
  };

  // 폰트 페어링
  fonts: {
    heading: string;
    body: string;
    accent: string;
  };
}

// ── V1 → V2 마이그레이션 ──────────────────────────────────

import type { CardNewsSlide } from './supabase';

/**
 * V1 슬라이드를 V2 포맷으로 마이그레이션
 * - headline → title TextLayer
 * - body → body TextLayer
 * - bg_image_url → image.url
 * - overlay_style → overlay 설정
 * - headline_style/body_style → TextLayer 스타일
 */
export function migrateSlideV1toV2(slide: CardNewsSlide, totalSlides: number): CardNewsSlideV2 {
  const isFirst = slide.position === 0;
  const isLast = slide.position === totalSlides - 1;
  const slideRole: SlideRole = isFirst ? 'cover' : isLast ? 'cta' : 'content';

  // 오버레이 매핑
  const overlayMap: Record<string, OverlaySettings> = {
    'dark': { type: 'solid', color: '#000000', opacity: 50 },
    'light': { type: 'solid', color: '#ffffff', opacity: 30 },
    'gradient-bottom': { type: 'gradient-bottom', color: '#000000', opacity: 80 },
    'gradient-top': { type: 'gradient-top', color: '#000000', opacity: 80 },
  };

  const hs = (slide as any).headline_style ?? {};
  const bs = (slide as any).body_style ?? {};

  const textLayers: TextLayer[] = [];

  // 브랜드 핸들
  textLayers.push({
    id: crypto.randomUUID(),
    role: 'handle',
    content: '@yeosonam',
    x: 4, y: 92, width: 30, height: 6,
    fontFamily: 'Pretendard', fontSize: 12, fontWeight: 'normal',
    color: 'rgba(255,255,255,0.4)', textAlign: 'left',
    opacity: 0.4,
  });

  // 로고
  textLayers.push({
    id: crypto.randomUUID(),
    role: 'brand',
    content: 'YEOSONAM',
    x: 4, y: 3, width: 30, height: 5,
    fontFamily: 'Pretendard', fontSize: 10, fontWeight: 'bold',
    color: 'rgba(255,255,255,0.6)', textAlign: 'left',
    letterSpacing: 3, textTransform: 'uppercase', opacity: 0.6,
  });

  // 제목
  if (slide.headline) {
    textLayers.push({
      id: crypto.randomUUID(),
      role: 'title',
      content: slide.headline,
      x: isFirst ? 5 : 5,
      y: isFirst ? 55 : 60,
      width: 90,
      height: 20,
      fontFamily: hs.fontFamily || 'Pretendard',
      fontSize: hs.fontSize || (isFirst ? 40 : 32),
      fontWeight: hs.fontWeight || 'bold',
      color: hs.color || '#ffffff',
      textAlign: (hs.textAlign as 'left' | 'center' | 'right') || (isFirst ? 'left' : 'left'),
      lineHeight: 1.2,
    });
  }

  // 본문
  if (slide.body) {
    textLayers.push({
      id: crypto.randomUUID(),
      role: 'body',
      content: slide.body,
      x: 5,
      y: isFirst ? 78 : 78,
      width: 90,
      height: 15,
      fontFamily: bs.fontFamily || 'Pretendard',
      fontSize: bs.fontSize || 18,
      fontWeight: bs.fontWeight || 'normal',
      color: bs.color || '#e0e0e0',
      textAlign: (bs.textAlign as 'left' | 'center' | 'right') || 'left',
      lineHeight: 1.4,
    });
  }

  // 페이지 번호
  textLayers.push({
    id: crypto.randomUUID(),
    role: 'page-number',
    content: `${slide.position + 1}/${totalSlides}`,
    x: 85, y: 92, width: 12, height: 6,
    fontFamily: 'Pretendard', fontSize: 11, fontWeight: 'normal',
    color: 'rgba(255,255,255,0.5)', textAlign: 'right',
    opacity: 0.5,
  });

  return {
    id: slide.id,
    position: slide.position,
    templateId: 'cinematic-dark',
    slideRole,
    image: {
      url: slide.bg_image_url || '',
      pexelsKeyword: slide.pexels_keyword || '',
      focusX: 50,
      focusY: 50,
      zoom: 1.0,
      brightness: 1.0,
    },
    overlay: overlayMap[slide.overlay_style] || overlayMap['gradient-bottom'],
    textLayers,
    designElements: [],
    // V1 호환 필드 유지
    headline: slide.headline,
    body: slide.body,
    bg_image_url: slide.bg_image_url,
    overlay_style: slide.overlay_style,
    pexels_keyword: slide.pexels_keyword,
  };
}

/**
 * 슬라이드가 V2 포맷인지 확인
 */
export function isV2Slide(slide: any): slide is CardNewsSlideV2 {
  return Array.isArray(slide?.textLayers);
}

/**
 * V1 또는 V2 슬라이드 배열을 V2로 정규화
 */
export function normalizeSlides(slides: any[]): CardNewsSlideV2[] {
  return slides.map((s, _i) => {
    if (isV2Slide(s)) return s;
    return migrateSlideV1toV2(s, slides.length);
  });
}
