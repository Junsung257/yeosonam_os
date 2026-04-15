/**
 * 여소남 브랜드 Placeholder (Pexels 실패 시 Fallback)
 *
 * SVG Data URL 10종. 외부 자산 업로드 없이 즉시 사용 가능.
 * 네이비 / 블루 / 골드 그라데이션 기반으로 브랜드 일관성 유지.
 */

import { BRAND_COLORS } from './tokens';

type GradientPair = [string, string];

const PAIRS: Record<string, GradientPair> = {
  navyBlue: [BRAND_COLORS.navy, BRAND_COLORS.blue],
  blueGold: [BRAND_COLORS.blue, BRAND_COLORS.gold],
  navyGold: [BRAND_COLORS.navy, BRAND_COLORS.gold],
  navyBlack: [BRAND_COLORS.black, BRAND_COLORS.navy],
  goldBlack: [BRAND_COLORS.black, BRAND_COLORS.gold],
};

interface PlaceholderConfig {
  gradient: GradientPair;
  angle: number;       // 그라데이션 각도
  layout: 'cover' | 'content' | 'cta';
  accent?: 'dot' | 'line' | 'frame';
  subtitle?: string;
}

const CONFIGS: PlaceholderConfig[] = [
  // cover — 로고 크게, 브랜드 각인
  { gradient: PAIRS.navyBlue, angle: 135, layout: 'cover', accent: 'line', subtitle: 'PREMIUM TRAVEL' },
  { gradient: PAIRS.navyBlack, angle: 180, layout: 'cover', accent: 'frame', subtitle: 'YEOSONAM.COM' },

  // content — 미니멀, 작은 로고
  { gradient: PAIRS.navyBlue, angle: 45, layout: 'content', accent: 'dot' },
  { gradient: PAIRS.navyBlue, angle: 90, layout: 'content', accent: 'line' },
  { gradient: PAIRS.navyGold, angle: 135, layout: 'content', accent: 'dot' },
  { gradient: PAIRS.blueGold, angle: 60, layout: 'content', accent: 'line' },
  { gradient: PAIRS.navyBlack, angle: 30, layout: 'content', accent: 'dot' },
  { gradient: PAIRS.navyBlue, angle: 120, layout: 'content', accent: 'frame' },

  // cta — 골드 강조
  { gradient: PAIRS.goldBlack, angle: 135, layout: 'cta', accent: 'line', subtitle: '지금 바로 확인' },
  { gradient: PAIRS.navyGold, angle: 45, layout: 'cta', accent: 'frame', subtitle: '여소남이 엄선한 상품' },
];

function buildSvg(cfg: PlaceholderConfig): string {
  const [c1, c2] = cfg.gradient;
  const rad = (cfg.angle * Math.PI) / 180;
  const x1 = 50 - Math.cos(rad) * 50;
  const y1 = 50 - Math.sin(rad) * 50;
  const x2 = 50 + Math.cos(rad) * 50;
  const y2 = 50 + Math.sin(rad) * 50;

  const size = 1080;
  const fontFamily = 'Pretendard, -apple-system, BlinkMacSystemFont, sans-serif';

  const logoFontSize = cfg.layout === 'cover' ? 96 : cfg.layout === 'cta' ? 72 : 48;
  const logoY = cfg.layout === 'cover' ? size / 2 : cfg.layout === 'cta' ? size * 0.45 : size * 0.5;
  const subtitleFontSize = cfg.layout === 'cover' ? 28 : 22;
  const textColor = BRAND_COLORS.white;
  const accentColor = cfg.layout === 'cta' ? BRAND_COLORS.gold : BRAND_COLORS.white;

  let accentElement = '';
  if (cfg.accent === 'line') {
    const lineY = logoY + logoFontSize * 0.55;
    accentElement = `<line x1="${size * 0.35}" y1="${lineY}" x2="${size * 0.65}" y2="${lineY}" stroke="${accentColor}" stroke-width="2" opacity="0.6"/>`;
  } else if (cfg.accent === 'dot') {
    const dotY = logoY + logoFontSize * 0.8;
    accentElement = `<circle cx="${size / 2}" cy="${dotY}" r="4" fill="${accentColor}" opacity="0.7"/>`;
  } else if (cfg.accent === 'frame') {
    const inset = 60;
    accentElement = `<rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" fill="none" stroke="${accentColor}" stroke-width="1.5" opacity="0.4"/>`;
  }

  const subtitleElement = cfg.subtitle
    ? `<text x="${size / 2}" y="${logoY + logoFontSize * 1.1}" font-family="${fontFamily}" font-size="${subtitleFontSize}" font-weight="400" fill="${textColor}" text-anchor="middle" opacity="0.75" letter-spacing="6">${cfg.subtitle}</text>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><defs><linearGradient id="g" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="${size}" height="${size}" fill="url(#g)"/>${accentElement}<text x="${size / 2}" y="${logoY}" font-family="${fontFamily}" font-size="${logoFontSize}" font-weight="700" fill="${textColor}" text-anchor="middle" letter-spacing="8">YEOSONAM</text>${subtitleElement}</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const BRAND_PLACEHOLDERS: string[] = CONFIGS.map(buildSvg);

const POOLS: Record<'cover' | 'content' | 'cta', number[]> = {
  cover: CONFIGS.map((c, i) => (c.layout === 'cover' ? i : -1)).filter(i => i >= 0),
  content: CONFIGS.map((c, i) => (c.layout === 'content' ? i : -1)).filter(i => i >= 0),
  cta: CONFIGS.map((c, i) => (c.layout === 'cta' ? i : -1)).filter(i => i >= 0),
};

function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * 용도별 Placeholder 1장 반환
 * @param purpose cover(표지) | content(본문) | cta(행동유도)
 * @param seed   주어지면 결정론적, 없으면 랜덤
 */
export function getBrandPlaceholder(
  purpose: 'cover' | 'content' | 'cta' = 'content',
  seed?: string | number,
): string {
  const pool = POOLS[purpose];
  if (pool.length === 0) return BRAND_PLACEHOLDERS[0];
  const idx = seed !== undefined
    ? pool[hashSeed(seed) % pool.length]
    : pool[Math.floor(Math.random() * pool.length)];
  return BRAND_PLACEHOLDERS[idx];
}
