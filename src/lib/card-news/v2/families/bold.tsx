/**
 * Bold Family — 네이비→블루→골드 그라데이션 + 중앙 대형 텍스트 + 장식 원
 * 베스트 매치: 가성비 특가, 가격 강조, 마감임박 마케팅
 *
 * 5 variants: cover / detail / tip / warning / cta
 */
import React from 'react';
import {
  Eyebrow, Headline, BodyBlock, TipBlock, WarningBlock,
  PriceChip, TrustRow, CTAButton, PhotoFrame, LogoCorner,
  PageIndicator, AccentLine, BadgePill,
} from '../atoms';
import { BRAND_COLORS, getHeadlineFontSize, getBodyFontSize, truncateHeadline, truncateBody } from '../../tokens';
import type { FamilyRegistry, VariantProps } from '../types';

function BoldBackground({ w, h, imageUrl }: { w: number; h: number; imageUrl?: string }): JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: w,
        height: h,
        display: 'flex',
        background: `linear-gradient(135deg, ${BRAND_COLORS.navy} 0%, ${BRAND_COLORS.blue} 60%, ${BRAND_COLORS.gold} 130%)`,
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
            opacity: 0.15,
          }}
        />
      )}
      {/* 장식 원 우상단 */}
      <div
        style={{
          position: 'absolute',
          top: -Math.round(w * 0.2),
          right: -Math.round(w * 0.2),
          width: Math.round(w * 0.5),
          height: Math.round(w * 0.5),
          display: 'flex',
          borderRadius: Math.round(w * 0.25),
          background: BRAND_COLORS.gold,
          opacity: 0.12,
        }}
      />
      {/* 장식 원 좌하단 */}
      <div
        style={{
          position: 'absolute',
          bottom: -Math.round(w * 0.15),
          left: -Math.round(w * 0.15),
          width: Math.round(w * 0.35),
          height: Math.round(w * 0.35),
          display: 'flex',
          borderRadius: Math.round(w * 0.175),
          background: BRAND_COLORS.white,
          opacity: 0.06,
        }}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Cover — 중앙 대형 텍스트 + 골드 배지
// ──────────────────────────────────────────────────────
function BoldCover({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
  const { w, h, safeInset } = format;
  const headlineText = truncateHeadline(slide.headline, 22);
  const bodyText = truncateBody(slide.body, 60);
  const headlineSize = getHeadlineFontSize(headlineText, 72);
  const bodySize = getBodyFontSize(bodyText, 24);

  return (
    <div
      style={{
        width: w,
        height: h,
        display: 'flex',
        position: 'relative',
        background: BRAND_COLORS.navy,
        fontFamily: 'Pretendard',
      }}
    >
      <BoldBackground w={w} h={h} imageUrl={slide.bg_image_url} />

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
          <PageIndicator pageIndex={pageIndex} totalPages={totalPages} color={BRAND_COLORS.gold} opacity={0.95} />
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
          {slide.badge && (
            <div style={{ display: 'flex', marginBottom: 22 }}>
              <BadgePill text={slide.badge} surface={BRAND_COLORS.gold} ink={BRAND_COLORS.navy} rounded />
            </div>
          )}
          <Headline
            text={headlineText}
            size={headlineSize}
            color={BRAND_COLORS.white}
            weight={900}
            align="center"
            lineHeight={1.05}
          />
          <div style={{ display: 'flex', height: 22 }} />
          <AccentLine width={64} height={3} color={BRAND_COLORS.gold} align="center" />
          <div style={{ display: 'flex', height: 22 }} />
          <BodyBlock text={bodyText} size={bodySize} color={BRAND_COLORS.white} opacity={0.92} align="center" />
          {slide.price_chip && (
            <div style={{ display: 'flex', marginTop: 22 }}>
              <PriceChip text={slide.price_chip} surface={BRAND_COLORS.gold} ink={BRAND_COLORS.navy} size={28} />
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            color: BRAND_COLORS.white,
            opacity: 0.6,
            fontSize: 11,
            letterSpacing: 2,
          }}
        >
          yeosonam.com
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Detail
// ──────────────────────────────────────────────────────
function BoldDetail({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
  const { w, h, safeInset } = format;
  const headlineText = truncateHeadline(slide.headline, 24);
  const bodyText = truncateBody(slide.body, 80);
  const headlineSize = getHeadlineFontSize(headlineText, 54);
  const bodySize = getBodyFontSize(bodyText, 22);

  return (
    <div
      style={{
        width: w,
        height: h,
        display: 'flex',
        position: 'relative',
        background: BRAND_COLORS.navy,
        fontFamily: 'Pretendard',
      }}
    >
      <BoldBackground w={w} h={h} imageUrl={slide.bg_image_url} />

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
          <PageIndicator pageIndex={pageIndex} totalPages={totalPages} color={BRAND_COLORS.gold} opacity={0.95} />
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {slide.eyebrow && (
            <div style={{ display: 'flex', marginBottom: 12 }}>
              <Eyebrow text={slide.eyebrow} color={BRAND_COLORS.gold} />
            </div>
          )}
          <Headline text={headlineText} size={headlineSize} color={BRAND_COLORS.white} weight={900} lineHeight={1.1} />
          <div style={{ display: 'flex', height: 16 }} />
          <AccentLine width={56} height={3} color={BRAND_COLORS.gold} />
          <div style={{ display: 'flex', height: 18 }} />
          <BodyBlock text={bodyText} size={bodySize} color={BRAND_COLORS.white} opacity={0.92} />
          {slide.trust_row && slide.trust_row.length > 0 && (
            <div style={{ display: 'flex', marginTop: 18 }}>
              <TrustRow items={slide.trust_row} surface="rgba(201,169,97,0.25)" ink={BRAND_COLORS.white} />
            </div>
          )}
          {slide.price_chip && (
            <div style={{ display: 'flex', marginTop: 18 }}>
              <PriceChip text={slide.price_chip} surface={BRAND_COLORS.gold} ink={BRAND_COLORS.navy} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Tip
// ──────────────────────────────────────────────────────
function BoldTip({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
  const { w, h, safeInset } = format;
  const headlineText = truncateHeadline(slide.headline, 22);
  const tipText = slide.tip || slide.body || '';
  const headlineSize = getHeadlineFontSize(headlineText, 50);

  return (
    <div
      style={{
        width: w,
        height: h,
        display: 'flex',
        position: 'relative',
        background: BRAND_COLORS.navy,
        fontFamily: 'Pretendard',
      }}
    >
      <BoldBackground w={w} h={h} imageUrl={slide.bg_image_url} />

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
          <PageIndicator pageIndex={pageIndex} totalPages={totalPages} color={BRAND_COLORS.gold} opacity={0.95} />
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Eyebrow text={slide.eyebrow || 'PRO TIP'} color={BRAND_COLORS.gold} />
          <div style={{ display: 'flex', height: 12 }} />
          <Headline text={headlineText} size={headlineSize} color={BRAND_COLORS.white} weight={900} />
          <div style={{ display: 'flex', height: 22 }} />
          <TipBlock
            text={tipText}
            label={slide.badge || 'TIP'}
            surface="rgba(255,255,255,0.12)"
            ink={BRAND_COLORS.white}
          />
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Warning
// ──────────────────────────────────────────────────────
function BoldWarning({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
  const { w, h, safeInset } = format;
  const headlineText = truncateHeadline(slide.headline, 22);
  const warnText = slide.warning || slide.body || '';
  const headlineSize = getHeadlineFontSize(headlineText, 50);

  return (
    <div
      style={{
        width: w,
        height: h,
        display: 'flex',
        position: 'relative',
        background: BRAND_COLORS.navy,
        fontFamily: 'Pretendard',
      }}
    >
      <BoldBackground w={w} h={h} imageUrl={slide.bg_image_url} />

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
          <PageIndicator pageIndex={pageIndex} totalPages={totalPages} color={BRAND_COLORS.gold} opacity={0.95} />
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Eyebrow text={slide.eyebrow || 'WATCH OUT'} color={BRAND_COLORS.red} />
          <div style={{ display: 'flex', height: 12 }} />
          <Headline text={headlineText} size={headlineSize} color={BRAND_COLORS.white} weight={900} />
          <div style={{ display: 'flex', height: 22 }} />
          <WarningBlock text={warnText} label={slide.badge || '주의'} />
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// CTA
// ──────────────────────────────────────────────────────
function BoldCTA({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
  const { w, h, safeInset } = format;
  const headlineText = truncateHeadline(slide.headline, 18);
  const bodyText = truncateBody(slide.body, 48);
  const headlineSize = getHeadlineFontSize(headlineText, 64);

  return (
    <div
      style={{
        width: w,
        height: h,
        display: 'flex',
        position: 'relative',
        background: BRAND_COLORS.navy,
        fontFamily: 'Pretendard',
      }}
    >
      <BoldBackground w={w} h={h} imageUrl={slide.bg_image_url} />

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
          <PageIndicator pageIndex={pageIndex} totalPages={totalPages} color={BRAND_COLORS.gold} opacity={0.95} />
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
            <div style={{ display: 'flex', marginBottom: 18 }}>
              <PriceChip text={slide.price_chip} surface={BRAND_COLORS.gold} ink={BRAND_COLORS.navy} size={28} />
            </div>
          )}
          <Headline
            text={headlineText}
            size={headlineSize}
            color={BRAND_COLORS.white}
            weight={900}
            align="center"
            lineHeight={1.05}
          />
          <div style={{ display: 'flex', height: 16 }} />
          <BodyBlock text={bodyText} size={22} color={BRAND_COLORS.white} opacity={0.92} align="center" />
          <div style={{ display: 'flex', height: 28 }} />
          <CTAButton label={slide.badge || '지금 예약하기'} surface={BRAND_COLORS.gold} ink={BRAND_COLORS.navy} />
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            color: BRAND_COLORS.white,
            opacity: 0.6,
            fontSize: 11,
            letterSpacing: 2,
          }}
        >
          yeosonam.com
        </div>
      </div>
    </div>
  );
}

export const BoldFamily: FamilyRegistry = {
  family: 'bold',
  variants: {
    cover: BoldCover,
    detail: BoldDetail,
    tip: BoldTip,
    warning: BoldWarning,
    cta: BoldCTA,
  },
};
