/**
 * Premium Family — 블랙 + 골드 보더 + 세리프 느낌의 타이포
 * 베스트 매치: 프리미엄, 5성급, 신혼여행, 럭셔리
 *
 * 5 variants: cover / detail / tip / warning / cta
 * 공통 비주얼: black bg, gold inner border, centered text, serif-like weight
 */
import React from 'react';
import {
  Eyebrow, Headline, BodyBlock, TipBlock, WarningBlock,
  PriceChip, TrustRow, CTAButton, PhotoFrame, LogoCorner,
  PageIndicator, AccentLine,
} from '../atoms';
import { BRAND_COLORS, getHeadlineFontSize, getBodyFontSize, truncateHeadline, truncateBody } from '../../tokens';
import type { FamilyRegistry, VariantProps } from '../types';

const GOLD = BRAND_COLORS.gold;

function GoldBorder({ w, h, inset = 22 }: { w: number; h: number; inset?: number }): JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        top: inset,
        left: inset,
        width: w - inset * 2,
        height: h - inset * 2,
        display: 'flex',
        border: `1.5px solid ${GOLD}`,
        opacity: 0.7,
      }}
    />
  );
}

function GoldHeader({
  pageIndex,
  totalPages,
}: {
  pageIndex: number;
  totalPages: number;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          color: GOLD,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 4,
        }}
      >
        YEOSONAM · PREMIUM
      </div>
      <PageIndicator pageIndex={pageIndex} totalPages={totalPages} color={GOLD} opacity={0.7} />
    </div>
  );
}

function GoldFooter(): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        color: GOLD,
        opacity: 0.6,
        fontSize: 10,
        fontWeight: 400,
        letterSpacing: 3,
      }}
    >
      yeosonam.com
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Cover
// ──────────────────────────────────────────────────────
function PremiumCover({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
  const { w, h, safeInset } = format;
  const headlineText = truncateHeadline(slide.headline, 22);
  const bodyText = truncateBody(slide.body, 60);
  const headlineSize = getHeadlineFontSize(headlineText, 58);
  const bodySize = getBodyFontSize(bodyText, 22);

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
      <PhotoFrame imageUrl={slide.bg_image_url} w={w} h={h} scrim="none" imageOpacity={0.42} />
      <GoldBorder w={w} h={h} />

      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          display: 'flex',
          flexDirection: 'column',
          padding: `${safeInset + 16}px ${safeInset + 20}px`,
        }}
      >
        <GoldHeader pageIndex={pageIndex} totalPages={totalPages} />

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
          {slide.eyebrow && (
            <div
              style={{
                display: 'flex',
                padding: '6px 16px',
                border: `1px solid ${GOLD}`,
                color: GOLD,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 3,
                marginBottom: 20,
              }}
            >
              {slide.eyebrow}
            </div>
          )}
          <AccentLine width={40} height={1} color={GOLD} align="center" />
          <div style={{ display: 'flex', height: 22 }} />
          <Headline
            text={headlineText}
            size={headlineSize}
            color={BRAND_COLORS.white}
            weight={700}
            align="center"
            lineHeight={1.2}
          />
          <div style={{ display: 'flex', height: 18 }} />
          <BodyBlock text={bodyText} size={bodySize} color={BRAND_COLORS.white} opacity={0.88} align="center" />
          <div style={{ display: 'flex', height: 22 }} />
          <AccentLine width={40} height={1} color={GOLD} align="center" />
          {slide.price_chip && (
            <div style={{ display: 'flex', marginTop: 22 }}>
              <PriceChip text={slide.price_chip} surface="transparent" ink={GOLD} size={22} />
            </div>
          )}
        </div>

        <GoldFooter />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Detail — 동일 비주얼, 본문 크게
// ──────────────────────────────────────────────────────
function PremiumDetail({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
  const { w, h, safeInset } = format;
  const headlineText = truncateHeadline(slide.headline, 22);
  const bodyText = truncateBody(slide.body, 80);
  const headlineSize = getHeadlineFontSize(headlineText, 48);
  const bodySize = getBodyFontSize(bodyText, 22);

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
      <PhotoFrame imageUrl={slide.bg_image_url} w={w} h={h} scrim="none" imageOpacity={0.35} />
      <GoldBorder w={w} h={h} />

      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          display: 'flex',
          flexDirection: 'column',
          padding: `${safeInset + 16}px ${safeInset + 20}px`,
        }}
      >
        <GoldHeader pageIndex={pageIndex} totalPages={totalPages} />

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
          {slide.eyebrow && (
            <div style={{ display: 'flex', marginBottom: 12 }}>
              <Eyebrow text={slide.eyebrow} color={GOLD} />
            </div>
          )}
          <AccentLine width={40} height={1} color={GOLD} align="center" />
          <div style={{ display: 'flex', height: 18 }} />
          <Headline
            text={headlineText}
            size={headlineSize}
            color={BRAND_COLORS.white}
            weight={700}
            align="center"
          />
          <div style={{ display: 'flex', height: 16 }} />
          <BodyBlock text={bodyText} size={bodySize} color={BRAND_COLORS.white} opacity={0.88} align="center" />
          {slide.trust_row && slide.trust_row.length > 0 && (
            <div style={{ display: 'flex', marginTop: 18, justifyContent: 'center' }}>
              <TrustRow items={slide.trust_row} surface="rgba(201,169,97,0.15)" ink={GOLD} />
            </div>
          )}
        </div>

        <GoldFooter />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Tip
// ──────────────────────────────────────────────────────
function PremiumTip({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
  const { w, h, safeInset } = format;
  const headlineText = truncateHeadline(slide.headline, 22);
  const tipText = slide.tip || slide.body || '';
  const headlineSize = getHeadlineFontSize(headlineText, 46);

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
      <PhotoFrame imageUrl={slide.bg_image_url} w={w} h={h} scrim="none" imageOpacity={0.28} />
      <GoldBorder w={w} h={h} />

      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          display: 'flex',
          flexDirection: 'column',
          padding: `${safeInset + 16}px ${safeInset + 20}px`,
        }}
      >
        <GoldHeader pageIndex={pageIndex} totalPages={totalPages} />

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
          <Eyebrow text={slide.eyebrow || 'PRO TIP'} color={GOLD} />
          <div style={{ display: 'flex', height: 12 }} />
          <Headline
            text={headlineText}
            size={headlineSize}
            color={BRAND_COLORS.white}
            weight={700}
            align="center"
          />
          <div style={{ display: 'flex', height: 22 }} />
          <div style={{ display: 'flex', width: '100%' }}>
            <TipBlock
              text={tipText}
              label={slide.badge || 'TIP'}
              surface="rgba(201,169,97,0.12)"
              ink={BRAND_COLORS.white}
            />
          </div>
        </div>

        <GoldFooter />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Warning
// ──────────────────────────────────────────────────────
function PremiumWarning({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
  const { w, h, safeInset } = format;
  const headlineText = truncateHeadline(slide.headline, 22);
  const warnText = slide.warning || slide.body || '';
  const headlineSize = getHeadlineFontSize(headlineText, 46);

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
      <PhotoFrame imageUrl={slide.bg_image_url} w={w} h={h} scrim="none" imageOpacity={0.25} />
      <GoldBorder w={w} h={h} />

      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          display: 'flex',
          flexDirection: 'column',
          padding: `${safeInset + 16}px ${safeInset + 20}px`,
        }}
      >
        <GoldHeader pageIndex={pageIndex} totalPages={totalPages} />

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
          <Eyebrow text={slide.eyebrow || 'CAUTION'} color={BRAND_COLORS.red} />
          <div style={{ display: 'flex', height: 12 }} />
          <Headline
            text={headlineText}
            size={headlineSize}
            color={BRAND_COLORS.white}
            weight={700}
            align="center"
          />
          <div style={{ display: 'flex', height: 22 }} />
          <div style={{ display: 'flex', width: '100%' }}>
            <WarningBlock text={warnText} label={slide.badge || '주의'} />
          </div>
        </div>

        <GoldFooter />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// CTA
// ──────────────────────────────────────────────────────
function PremiumCTA({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
  const { w, h, safeInset } = format;
  const headlineText = truncateHeadline(slide.headline, 18);
  const bodyText = truncateBody(slide.body, 48);
  const headlineSize = getHeadlineFontSize(headlineText, 54);

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
      <PhotoFrame imageUrl={slide.bg_image_url} w={w} h={h} scrim="full" imageOpacity={0.5} />
      <GoldBorder w={w} h={h} />

      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          display: 'flex',
          flexDirection: 'column',
          padding: `${safeInset + 16}px ${safeInset + 20}px`,
        }}
      >
        <GoldHeader pageIndex={pageIndex} totalPages={totalPages} />

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
              <PriceChip text={slide.price_chip} surface="transparent" ink={GOLD} size={24} />
            </div>
          )}
          <Headline
            text={headlineText}
            size={headlineSize}
            color={BRAND_COLORS.white}
            weight={800}
            align="center"
            lineHeight={1.1}
          />
          <div style={{ display: 'flex', height: 14 }} />
          <BodyBlock text={bodyText} size={22} color={BRAND_COLORS.white} opacity={0.92} align="center" />
          <div style={{ display: 'flex', height: 24 }} />
          <CTAButton label={slide.badge || '지금 예약하기'} surface={GOLD} ink={BRAND_COLORS.black} />
        </div>

        <GoldFooter />
      </div>
    </div>
  );
}

export const PremiumFamily: FamilyRegistry = {
  family: 'premium',
  variants: {
    cover: PremiumCover,
    detail: PremiumDetail,
    tip: PremiumTip,
    warning: PremiumWarning,
    cta: PremiumCTA,
  },
};
