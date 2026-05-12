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
    description: '풀블리드 이미지 + 강한 scrim + 오렌지 악센트',
    bestFor: '자연 풍경, 감성 여행',
    satoriReady: true,
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
    satoriReady: true,
  },
  magazine: {
    label: '매거진',
    description: '번호(01, 02) + 빨간 배지',
    bestFor: '스토리, 효도',
    satoriReady: true,
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
 * 1080×1080 기준. Instagram 권장 heading 70pt+ 를 충족하도록 기본값 상향.
 */
export function getHeadlineFontSize(text: string, baseSize: number = 80): number {
  const len = (text ?? '').length;
  if (len <= 8)  return baseSize;
  if (len <= 12) return Math.round(baseSize * 0.9);
  if (len <= 16) return Math.round(baseSize * 0.78);
  if (len <= 20) return Math.round(baseSize * 0.68);
  return Math.round(baseSize * 0.58);  // 20자 초과 안전망
}

export function getBodyFontSize(text: string, baseSize: number = 30): number {
  const len = (text ?? '').length;
  if (len <= 20) return baseSize;
  if (len <= 40) return Math.round(baseSize * 0.93);
  if (len <= 60) return Math.round(baseSize * 0.85);
  return Math.round(baseSize * 0.75);
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

/**
 * Category-based palette suggestion (Annals of Tourism Research 2021 검증 기반)
 *   - nature/scenic/architecture → blue 우세
 *   - food/street/ambience       → warm red/orange
 *   - data/info/listicle         → navy + 강한 contrast
 *   - premium/luxury             → gold + black
 *   - default                    → editorial neutrals
 *
 * 카테고리·키워드 추론은 caller (structure-designer, copywriter) 에서 1순위 카테고리 1개만 넘길 것.
 */
export type PaletteCategory =
  | 'nature'
  | 'architecture'
  | 'food'
  | 'street'
  | 'data_story'
  | 'premium'
  | 'urgency'
  | 'default';

export function getPaletteForCategory(cat: PaletteCategory): {
  primary: string;
  accent: string;
  bg: string;
  rationale: string;
} {
  switch (cat) {
    case 'nature':
    case 'architecture':
      return { primary: BRAND_COLORS.navy, accent: BRAND_COLORS.blue, bg: BRAND_COLORS.softBg, rationale: 'blue dominant lifts engagement for nature/scenery (Annals of Tourism Research 2021)' };
    case 'food':
    case 'street':
      return { primary: BRAND_COLORS.orange, accent: BRAND_COLORS.red, bg: BRAND_COLORS.softBg, rationale: 'warm red/orange wins for street food + ambience' };
    case 'data_story':
      return { primary: BRAND_COLORS.navy, accent: BRAND_COLORS.red, bg: BRAND_COLORS.white, rationale: 'high contrast helps numeric callouts read in feed' };
    case 'premium':
      return { primary: BRAND_COLORS.black, accent: BRAND_COLORS.gold, bg: BRAND_COLORS.black, rationale: 'gold + black for honeymoon/luxury' };
    case 'urgency':
      return { primary: BRAND_COLORS.red, accent: BRAND_COLORS.navy, bg: BRAND_COLORS.white, rationale: 'red urgency for D-N / 선착순' };
    case 'default':
    default:
      return { primary: BRAND_COLORS.navy, accent: BRAND_COLORS.blue, bg: BRAND_COLORS.softBg, rationale: 'editorial neutrals' };
  }
}

/** carousel slide count sweet spot (Hootsuite/postnitro 2026) */
export const CAROUSEL_SWEET_SPOT_MIN = 7;
export const CAROUSEL_SWEET_SPOT_MAX = 10;

/**
 * Engagement-bait blacklist — Meta 2024-10 페널티 대상.
 * Threads/IG 발행 직전 검사. 매칭 시 거부 또는 자동 재생성.
 */
export const ENGAGEMENT_BAIT_PATTERNS: RegExp[] = [
  /follow\s+for\s+more/i,
  /tag\s+\d+\s+friends?/i,
  /친구\s*소환/,
  /팔로우\s*해주세요/,
  /쉐어\s*해주세요/,
  /좋아요\s*눌러주세요/,
  /공유\s*해주세요/,
  /100%\s*후회\s*안/,
  /무조건\s*가야/,
  /절대\s*후회\s*없/,
];

export function detectEngagementBait(text: string): string | null {
  for (const pat of ENGAGEMENT_BAIT_PATTERNS) {
    if (pat.test(text)) return pat.source;
  }
  return null;
}

/**
 * Threads hook 단어 수 검증 (Berman 10K hook analysis 2025).
 *   - sweet spot 10~20 words
 *   - 20 단어 초과 시 단어당 ~3% 성능 감소
 */
export function countWordsForThreadsHook(text: string): number {
  // Korean: 어절(공백 분리). Mixed: 공백 단위로 동일 처리.
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export const THREADS_HOOK_MIN_WORDS = 6;
export const THREADS_HOOK_MAX_WORDS = 20;
export const THREADS_HOOK_SWEET_SPOT_MIN = 10;
export const THREADS_HOOK_SWEET_SPOT_MAX = 20;
