/**
 * 카드뉴스 V2 Atoms — Satori-safe + 브라우저 동일 렌더
 *
 * 모든 atom은:
 *  - display: 'flex' 명시 (Satori 요구)
 *  - 인라인 style만 사용 (Tailwind 금지)
 *  - box-shadow / filter / mixBlendMode 금지
 *  - 한 atom = 하나의 의미 단위 (Eyebrow, Headline, TipBlock ...)
 *
 * Template Family는 이 atom들의 조합 레시피.
 */
import React from 'react';
import { BRAND_COLORS } from '../tokens';

// ──────────────────────────────────────────────────────
// 0. Token bag — brand kit 확장 대비 (V2 단계는 단일 기본 브랜드)
// ──────────────────────────────────────────────────────
export interface BrandTokens {
  primary: string;    // 메인 색 (네이비)
  accent: string;     // 악센트 (블루/오렌지/골드)
  ink: string;        // 본문 텍스트
  mute: string;       // 보조 텍스트
  surface: string;    // 배경
  inverse: string;    // 역대비 텍스트 (위에 놓일 때)
  danger: string;     // 경고
  success: string;    // 성공
  gold: string;
}

export const DEFAULT_BRAND_TOKENS: BrandTokens = {
  primary: BRAND_COLORS.navy,
  accent: BRAND_COLORS.blue,
  ink: BRAND_COLORS.navy,
  mute: BRAND_COLORS.slate,
  surface: BRAND_COLORS.white,
  inverse: BRAND_COLORS.white,
  danger: BRAND_COLORS.red,
  success: BRAND_COLORS.orange,
  gold: BRAND_COLORS.gold,
};

// ──────────────────────────────────────────────────────
// 1. Eyebrow — 카테고리 태그 (Headline 위 1줄)
// ──────────────────────────────────────────────────────
export interface EyebrowProps {
  text: string;
  color?: string;
  size?: number;
  letterSpacing?: number;
}
export function Eyebrow({ text, color, size = 12, letterSpacing = 3 }: EyebrowProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        color: color ?? BRAND_COLORS.blue,
        fontSize: size,
        fontWeight: 700,
        letterSpacing,
      }}
    >
      {text.toUpperCase()}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 2. Headline — 슬라이드의 핵심 제목
// ──────────────────────────────────────────────────────
export interface HeadlineProps {
  text: string;
  size: number;
  color?: string;
  weight?: number;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
}
export function Headline({
  text,
  size,
  color,
  weight = 700,
  align = 'left',
  lineHeight = 1.2,
}: HeadlineProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        color: color ?? BRAND_COLORS.navy,
        fontSize: size,
        fontWeight: weight,
        lineHeight,
        letterSpacing: -0.6,
        textAlign: align,
      }}
    >
      {text}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 3. BodyBlock — 본문 (2~3줄)
// ──────────────────────────────────────────────────────
export interface BodyBlockProps {
  text: string;
  size: number;
  color?: string;
  opacity?: number;
  align?: 'left' | 'center' | 'right';
}
export function BodyBlock({
  text,
  size,
  color,
  opacity = 1,
  align = 'left',
}: BodyBlockProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        color: color ?? BRAND_COLORS.slate,
        fontSize: size,
        fontWeight: 400,
        lineHeight: 1.55,
        opacity,
        textAlign: align,
      }}
    >
      {text}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 4. TipBlock — "Pro tip" 스타일의 꿀팁 블록
// ──────────────────────────────────────────────────────
export interface TipBlockProps {
  label?: string;     // 기본: "TIP"
  text: string;
  surface?: string;   // 배경 색
  ink?: string;       // 텍스트 색
}
export function TipBlock({
  label = 'TIP',
  text,
  surface,
  ink,
}: TipBlockProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '14px 18px',
        background: surface ?? '#f0f6fb',
        borderLeft: `4px solid ${BRAND_COLORS.blue}`,
        borderRadius: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          color: BRAND_COLORS.blue,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 2,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: 'flex',
          color: ink ?? BRAND_COLORS.navy,
          fontSize: 16,
          fontWeight: 500,
          lineHeight: 1.5,
        }}
      >
        {text}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 5. WarningBlock — "Mistake" / 주의사항 블록
// ──────────────────────────────────────────────────────
export interface WarningBlockProps {
  label?: string;  // 기본: "주의"
  text: string;
}
export function WarningBlock({ label = '주의', text }: WarningBlockProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '14px 18px',
        background: '#fef2f2',
        borderLeft: `4px solid ${BRAND_COLORS.red}`,
        borderRadius: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          color: BRAND_COLORS.red,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 2,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: 'flex',
          color: '#7f1d1d',
          fontSize: 16,
          fontWeight: 500,
          lineHeight: 1.5,
        }}
      >
        {text}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 6. PriceChip — 가격 강조 칩
// ──────────────────────────────────────────────────────
export interface PriceChipProps {
  text: string;       // "89,900원~"
  surface?: string;
  ink?: string;
  size?: number;
}
export function PriceChip({ text, surface, ink, size = 22 }: PriceChipProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        padding: '6px 14px',
        background: surface ?? BRAND_COLORS.orange,
        color: ink ?? BRAND_COLORS.white,
        fontSize: size,
        fontWeight: 800,
        letterSpacing: -0.3,
        borderRadius: 999,
      }}
    >
      {text}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 7. TrustRow — 신뢰 시그널 칩 나열 ["노팁","노옵션","5성급"]
// ──────────────────────────────────────────────────────
export interface TrustRowProps {
  items: string[];
  ink?: string;
  surface?: string;
}
export function TrustRow({ items, ink, surface }: TrustRowProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
      }}
    >
      {items.map((t, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            padding: '4px 10px',
            marginRight: 6,
            marginBottom: 6,
            background: surface ?? 'rgba(255,255,255,0.15)',
            color: ink ?? BRAND_COLORS.white,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 0.5,
            borderRadius: 3,
          }}
        >
          {t}
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 8. CTAButton — 예약 유도 버튼 (카드뉴스 마지막 장)
// ──────────────────────────────────────────────────────
export interface CTAButtonProps {
  label: string;      // "지금 예약하기"
  surface?: string;
  ink?: string;
  size?: number;
}
export function CTAButton({
  label,
  surface,
  ink,
  size = 20,
}: CTAButtonProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        padding: '14px 32px',
        background: surface ?? BRAND_COLORS.orange,
        color: ink ?? BRAND_COLORS.white,
        fontSize: size,
        fontWeight: 800,
        letterSpacing: 0.5,
        borderRadius: 999,
      }}
    >
      {label}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 9. PhotoFrame — 배경 이미지 + scrim 프리셋
// ──────────────────────────────────────────────────────
export type ScrimPreset = 'none' | 'top' | 'bottom' | 'full' | 'u-curve';
export interface PhotoFrameProps {
  imageUrl?: string;
  w: number;
  h: number;
  scrim?: ScrimPreset;
  imageOpacity?: number;
  fallbackBg?: string;
}
const SCRIM_STYLES: Record<ScrimPreset, string> = {
  none: 'transparent',
  top: 'linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 60%)',
  bottom: 'linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.85) 100%)',
  full: 'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.75) 100%)',
  'u-curve':
    'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 28%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0.75) 85%, rgba(0,0,0,0.92) 100%)',
};
export function PhotoFrame({
  imageUrl,
  w,
  h,
  scrim = 'u-curve',
  imageOpacity = 1,
  fallbackBg = BRAND_COLORS.navy,
}: PhotoFrameProps): JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: w,
        height: h,
        display: 'flex',
        background: fallbackBg,
      }}
    >
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
        <img
          src={imageUrl}
          width={w}
          height={h}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: w,
            height: h,
            objectFit: 'cover',
            opacity: imageOpacity,
          }}
        />
      )}
      {scrim !== 'none' && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: w,
            height: h,
            display: 'flex',
            background: SCRIM_STYLES[scrim],
          }}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 10. LogoCorner — 브랜드 로고 코너 (좌상단 기본)
// ──────────────────────────────────────────────────────
export interface LogoCornerProps {
  label?: string;       // "YEOSONAM"
  variant?: 'light' | 'dark' | 'gold';
  align?: 'left' | 'right';
}
export function LogoCorner({
  label = 'YEOSONAM',
  variant = 'light',
  align = 'left',
}: LogoCornerProps): JSX.Element {
  const color =
    variant === 'gold' ? BRAND_COLORS.gold : variant === 'dark' ? BRAND_COLORS.navy : BRAND_COLORS.white;
  return (
    <div
      style={{
        display: 'flex',
        color,
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: 3,
        alignSelf: align === 'right' ? 'flex-end' : 'flex-start',
      }}
    >
      {label}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 11. PageIndicator — "02 / 08"
// ──────────────────────────────────────────────────────
export interface PageIndicatorProps {
  pageIndex?: number;
  totalPages?: number;
  color?: string;
  opacity?: number;
}
export function PageIndicator({
  pageIndex,
  totalPages,
  color,
  opacity = 0.75,
}: PageIndicatorProps): JSX.Element | null {
  if (!pageIndex || !totalPages) return null;
  return (
    <div
      style={{
        display: 'flex',
        color: color ?? BRAND_COLORS.white,
        fontSize: 11,
        fontWeight: 400,
        letterSpacing: 2,
        opacity,
      }}
    >
      {String(pageIndex).padStart(2, '0')} / {String(totalPages).padStart(2, '0')}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 12. NumberCorner — Magazine family 큰 번호 (01 02 03...)
// ──────────────────────────────────────────────────────
export interface NumberCornerProps {
  value: number;
  size: number;
  color?: string;
  opacity?: number;
  align?: 'left' | 'right';
}
export function NumberCorner({
  value,
  size,
  color,
  opacity = 0.18,
  align = 'left',
}: NumberCornerProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        fontSize: size,
        fontWeight: 900,
        color: color ?? BRAND_COLORS.white,
        opacity,
        lineHeight: 0.85,
        letterSpacing: -4,
        alignSelf: align === 'right' ? 'flex-end' : 'flex-start',
      }}
    >
      {String(value).padStart(2, '0')}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 13. AccentLine — 얇은 악센트 라인 (Headline 위/아래 구분선)
// ──────────────────────────────────────────────────────
export interface AccentLineProps {
  width: number;
  height?: number;
  color?: string;
  align?: 'flex-start' | 'center' | 'flex-end';
}
export function AccentLine({
  width,
  height = 2,
  color,
  align = 'flex-start',
}: AccentLineProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        width,
        height,
        background: color ?? BRAND_COLORS.blue,
        alignSelf: align,
      }}
    />
  );
}

// ──────────────────────────────────────────────────────
// 14. BadgePill — "핵심" "NEW" 등 작은 칩 배지 (Eyebrow와 구분: Eyebrow는 대문자 텍스트, BadgePill은 색 배경)
// ──────────────────────────────────────────────────────
export interface BadgePillProps {
  text: string;
  surface?: string;
  ink?: string;
  align?: 'flex-start' | 'center' | 'flex-end';
  rounded?: boolean;
}
export function BadgePill({
  text,
  surface,
  ink,
  align = 'flex-start',
  rounded = false,
}: BadgePillProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        padding: '5px 12px',
        background: surface ?? BRAND_COLORS.navy,
        color: ink ?? BRAND_COLORS.white,
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: 1.5,
        borderRadius: rounded ? 999 : 3,
        alignSelf: align,
      }}
    >
      {text}
    </div>
  );
}
