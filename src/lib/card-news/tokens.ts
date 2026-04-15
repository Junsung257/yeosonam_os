/**
 * 여소남 카드뉴스 디자인 토큰 (DOM 템플릿 + Satori 템플릿 공용)
 *
 * 모든 템플릿 컴포넌트가 이 상수를 공유하여 브랜드 일관성 유지.
 * 컬러/폰트 변경 시 여기만 수정.
 */

export const BRAND_COLORS = {
  navy: '#001f3f',       // Primary — 헤드라인, 주요 텍스트
  blue: '#005d90',       // Accent — 강조, 링크, 포커스
  gold: '#c9a961',       // Gold — 프리미엄 템플릿 악센트
  white: '#ffffff',      // Text on dark
  black: '#0a0a0a',      // Dark bg
  softBg: '#f8f9fb',     // Light template bg
  slate: '#475569',      // 보조 텍스트
  slateLight: '#94a3b8', // 연한 보조
  orange: '#ea580c',     // Cinematic 악센트
  red: '#dc2626',        // Magazine 배지
} as const;

export const BRAND_FONTS = {
  sans: 'Pretendard, -apple-system, BlinkMacSystemFont, sans-serif',
  serif: '"Noto Serif KR", "Playfair Display", Georgia, serif',
  mono: '"JetBrains Mono", monospace',
} as const;

export const TEMPLATE_IDS = [
  'dark_cinematic',
  'clean_white',
  'bold_gradient',
  'magazine',
  'luxury_gold',
] as const;

export type TemplateId = typeof TEMPLATE_IDS[number];

export const TEMPLATE_META: Record<TemplateId, {
  label: string;
  description: string;
  bestFor: string;
  satoriReady: boolean;  // Satori로 서버렌더 가능한지
}> = {
  dark_cinematic: {
    label: '다크 시네마틱',
    description: '풀블리드 이미지 + 그라데이션 + 오렌지 악센트',
    bestFor: '자연 풍경, 감성 여행',
    satoriReady: false,  // 나중에 마이그레이션
  },
  clean_white: {
    label: '클린 화이트',
    description: '상단 이미지 + 하단 흰 카드',
    bestFor: '정보성, 가이드',
    satoriReady: true,
  },
  bold_gradient: {
    label: '볼드 그라디언트',
    description: '네이비→블루 그라데이션 + 중앙 대형 텍스트',
    bestFor: '가성비, 특가',
    satoriReady: false,
  },
  magazine: {
    label: '매거진',
    description: '번호(01, 02) + 빨간 배지',
    bestFor: '스토리, 효도',
    satoriReady: false,
  },
  luxury_gold: {
    label: '럭셔리 골드',
    description: '블랙 + 골드 보더 + 세리프',
    bestFor: '프리미엄, 신혼',
    satoriReady: true,
  },
};

/**
 * 글자 수 기반 반응형 폰트 크기 (오버플로 방지)
 */
export function getHeadlineFontSize(text: string, baseSize: number = 52): number {
  const len = (text ?? '').length;
  if (len <= 10) return baseSize;
  if (len <= 15) return Math.round(baseSize * 0.85);
  if (len <= 20) return Math.round(baseSize * 0.7);
  return Math.round(baseSize * 0.6);  // 20자 초과 (안전망)
}

export function getBodyFontSize(text: string, baseSize: number = 20): number {
  const len = (text ?? '').length;
  if (len <= 20) return baseSize;
  if (len <= 40) return Math.round(baseSize * 0.9);
  if (len <= 60) return Math.round(baseSize * 0.8);
  return Math.round(baseSize * 0.7);
}

/**
 * 글자 수 강제 truncate (프롬프트 실패 시 안전망)
 */
export function truncateHeadline(text: string, max: number = 20): string {
  if (!text) return '';
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

export function truncateBody(text: string, max: number = 50): string {
  if (!text) return '';
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}
