/**
 * Cinematic Family — 풀블리드 이미지 + 강한 scrim + 오렌지 악센트
 * 베스트 매치: 자연 풍경, 감성 여행, 야경, 모험
 *
 * 4 variants: cover / detail / tip / warning / cta
 */
import React from 'react';
import {
  Eyebrow, Headline, BodyBlock, TipBlock, WarningBlock,
  PriceChip, TrustRow, CTAButton, PhotoFrame, LogoCorner,
  PageIndicator, AccentLine, BadgePill,
} from '../atoms';
import { BRAND_COLORS, getHeadlineFontSize, getBodyFontSize, truncateHeadline, truncateBody } from '../../tokens';
import type { FamilyRegistry, VariantProps } from '../types';

// ──────────────────────────────────────────────────────
// Cover — 풀블리드 + 하단 텍스트 (U-curve scrim)
// ──────────────────────────────────────────────────────
function CinematicCover({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
  const { w, h, safeInset } = format;
  const headlineText = truncateHeadline(slide.headline, 22);
  const bodyText = truncateBody(slide.body, 60);
  const headlineSize = getHeadlineFontSize(headlineText, 64);
  const bodySize = getBodyFontSize(bodyText, 24);
  const accent = slide.accent_color || BRAND_COLORS.orange;

  return (
    <div
      style={{
        width: w,
        height: h,
        display: 'flex',
        position: 'relative',
        background: BRAND_COLORS.black,
        fontFamily: 'Pretendard',
      }}
    >
      <PhotoFrame imageUrl={slide.bg_image_url} w={w} h={h} scrim="u-curve" />

      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          display: 'flex',
          flexDirection: 'column',
          padding: `${safeInset + 16}px ${safeInset}px`,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <LogoCorner variant="light" />
          <PageIndicator pageIndex={pageIndex} totalPages={totalPages} />
        </div>

        <div style={{ flex: 1, display: 'flex' }} />

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {slide.eyebrow && (
            <div style={{ display: 'flex', marginBottom: 14 }}>
              <Eyebrow text={slide.eyebrow} color={accent} />
            </div>
          )}
          {slide.badge && !slide.eyebrow && (
            <div style={{ display: 'flex', marginBottom: 14 }}>
              <BadgePill text={slide.badge} surface={accent} />
            </div>
          )}
          <Headline text={headlineText} size={headlineSize} color={BRAND_COLORS.white} weight={900} lineHeight={1.1} />
          <div style={{ display: 'flex', height: 16 }} />
          <AccentLine width={56} height={3} color={accent} />
          <div style={{ display: 'flex', height: 16 }} />
          <BodyBlock text={bodyText} size={bodySize} color={BRAND_COLORS.white} opacity={0.95} />
          {slide.trust_row && slide.trust_row.length > 0 && (
            <div style={{ display: 'flex', marginTop: 16 }}>
              <TrustRow items={slide.trust_row} />
            </div>
          )}
          {slide.price_chip && (
            <div style={{ display: 'flex', marginTop: 16 }}>
              <PriceChip text={slide.price_chip} surface={accent} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Detail — 배경 이미지 어둡게 + 중앙 텍스트 (cover 과 유사하나 constrained)
// ──────────────────────────────────────────────────────
function CinematicDetail({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
  const { w, h, safeInset } = format;
  const headlineText = truncateHeadline(slide.headline, 24);
  const bodyText = truncateBody(slide.body, 80);
  const headlineSize = getHeadlineFontSize(headlineText, 50);
  const bodySize = getBodyFontSize(bodyText, 22);
  const accent = slide.accent_color || BRAND_COLORS.orange;

  return (
    <div
      style={{
        width: w,
        height: h,
        display: 'flex',
        position: 'relative',
        background: BRAND_COLORS.black,
        fontFamily: 'Pretendard',
      }}
    >
      <PhotoFrame imageUrl={slide.bg_image_url} w={w} h={h} scrim="full" imageOpacity={0.6} />

      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          display: 'flex',
          flexDirection: 'column',
          padding: `${safeInset + 16}px ${safeInset}px`,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <LogoCorner variant="light" />
          <PageIndicator pageIndex={pageIndex} totalPages={totalPages} />
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {slide.eyebrow && (
            <div style={{ display: 'flex', marginBottom: 12 }}>
              <Eyebrow text={slide.eyebrow} color={accent} />
            </div>
          )}
          <Headline text={headlineText} size={headlineSize} color={BRAND_COLORS.white} weight={800} lineHeight={1.15} />
          <div style={{ display: 'flex', height: 14 }} />
          <AccentLine width={48} height={3} color={accent} />
          <div style={{ display: 'flex', height: 18 }} />
          <BodyBlock text={bodyText} size={bodySize} color={BRAND_COLORS.white} opacity={0.92} />

          {slide.tip && (
            <div style={{ display: 'flex', marginTop: 22 }}>
              <TipBlock text={slide.tip} surface="rgba(255,255,255,0.12)" ink={BRAND_COLORS.white} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Tip — dim photo + TipBlock 크게
// ──────────────────────────────────────────────────────
function CinematicTip({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
  const { w, h, safeInset } = format;
  const headlineText = truncateHeadline(slide.headline, 22);
  const tipText = slide.tip || slide.body || '';
  const headlineSize = getHeadlineFontSize(headlineText, 48);
  const accent = slide.accent_color || BRAND_COLORS.orange;

  return (
    <div
      style={{
        width: w,
        height: h,
        display: 'flex',
        position: 'relative',
        background: BRAND_COLORS.black,
        fontFamily: 'Pretendard',
      }}
    >
      <PhotoFrame imageUrl={slide.bg_image_url} w={w} h={h} scrim="full" imageOpacity={0.4} />

      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          display: 'flex',
          flexDirection: 'column',
          padding: `${safeInset + 16}px ${safeInset}px`,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <LogoCorner variant="light" />
          <PageIndicator pageIndex={pageIndex} totalPages={totalPages} />
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Eyebrow text={slide.eyebrow || 'PRO TIP'} color={accent} />
          <div style={{ display: 'flex', height: 14 }} />
          <Headline text={headlineText} size={headlineSize} color={BRAND_COLORS.white} weight={800} />
          <div style={{ display: 'flex', height: 24 }} />
          <TipBlock text={tipText} label={slide.badge || '꿀팁'} surface="rgba(255,255,255,0.12)" ink={BRAND_COLORS.white} />
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Warning — dim photo + WarningBlock
// ──────────────────────────────────────────────────────
function CinematicWarning({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
  const { w, h, safeInset } = format;
  const headlineText = truncateHeadline(slide.headline, 22);
  const warnText = slide.warning || slide.body || '';
  const headlineSize = getHeadlineFontSize(headlineText, 48);

  return (
    <div
      style={{
        width: w,
        height: h,
        display: 'flex',
        position: 'relative',
        background: BRAND_COLORS.black,
        fontFamily: 'Pretendard',
      }}
    >
      <PhotoFrame imageUrl={slide.bg_image_url} w={w} h={h} scrim="full" imageOpacity={0.35} />

      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          display: 'flex',
          flexDirection: 'column',
          padding: `${safeInset + 16}px ${safeInset}px`,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <LogoCorner variant="light" />
          <PageIndicator pageIndex={pageIndex} totalPages={totalPages} />
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Eyebrow text={slide.eyebrow || 'WATCH OUT'} color={BRAND_COLORS.red} />
          <div style={{ display: 'flex', height: 14 }} />
          <Headline text={headlineText} size={headlineSize} color={BRAND_COLORS.white} weight={800} />
          <div style={{ display: 'flex', height: 24 }} />
          <WarningBlock text={warnText} label={slide.badge || '주의'} />
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// CTA — 배경 이미지 + 하단 오렌지 배너 + CTA 버튼
// ──────────────────────────────────────────────────────
function CinematicCTA({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
  const { w, h, safeInset } = format;
  const headlineText = truncateHeadline(slide.headline, 18);
  const bodyText = truncateBody(slide.body, 48);
  const headlineSize = getHeadlineFontSize(headlineText, 54);
  const accent = slide.accent_color || BRAND_COLORS.orange;

  return (
    <div
      style={{
        width: w,
        height: h,
        display: 'flex',
        position: 'relative',
        background: BRAND_COLORS.black,
        fontFamily: 'Pretendard',
      }}
    >
      <PhotoFrame imageUrl={slide.bg_image_url} w={w} h={h} scrim="u-curve" imageOpacity={0.75} />

      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          display: 'flex',
          flexDirection: 'column',
          padding: `${safeInset + 16}px ${safeInset}px`,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <LogoCorner variant="light" />
          <PageIndicator pageIndex={pageIndex} totalPages={totalPages} />
        </div>

        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            textAlign: 'center',
          }}
        >
          {slide.price_chip && (
            <div style={{ display: 'flex', marginBottom: 16 }}>
              <PriceChip text={slide.price_chip} surface={accent} size={26} />
            </div>
          )}
          <Headline
            text={headlineText}
            size={headlineSize}
            color={BRAND_COLORS.white}
            weight={900}
            align="center"
            lineHeight={1.1}
          />
          <div style={{ display: 'flex', height: 14 }} />
          <BodyBlock text={bodyText} size={22} color={BRAND_COLORS.white} opacity={0.95} align="center" />
          <div style={{ display: 'flex', height: 28 }} />
          <CTAButton label={slide.badge || '지금 확인하기'} surface={accent} />
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            color: BRAND_COLORS.white,
            fontSize: 11,
            fontWeight: 400,
            letterSpacing: 2,
            opacity: 0.85,
          }}
        >
          yeosonam.com
        </div>
      </div>
    </div>
  );
}

export const CinematicFamily: FamilyRegistry = {
  family: 'cinematic',
  variants: {
    cover: CinematicCover,
    detail: CinematicDetail,
    tip: CinematicTip,
    warning: CinematicWarning,
    cta: CinematicCTA,
  },
};
