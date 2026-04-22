/**
 * Editorial Family — 하얀 카드 + 정갈한 인포그래픽
 *
 * 레퍼런스: Claude Artifacts 가이드, 한국 매거진형 카드뉴스
 * 베스트 매치: 정보성/가이드, 단계별 설명, 주의사항 공유
 *
 * 4 variants:
 *  - Cover   (role: hook)     : 상단 이미지 + 하단 큰 카드 (eyebrow / headline / trust)
 *  - Detail  (role: benefit/detail/inclusion) : 전면 흰 카드 + 액센트 라인 + body
 *  - Tip     (role: tip)      : 흰 카드 + TipBlock 중심
 *  - CTA     (role: cta)      : 악센트 배경 + 큰 CTA 버튼 + 가격
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
// Cover — 상단 이미지 + 하단 흰 카드
// ──────────────────────────────────────────────────────
function EditorialCover({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
  const { w, h, safeInset } = format;
  const headlineText = truncateHeadline(slide.headline, 22);
  const bodyText = truncateBody(slide.body, 60);
  const headlineSize = getHeadlineFontSize(headlineText, 58);
  const bodySize = getBodyFontSize(bodyText, 22);
  const imageH = Math.round(h * 0.58);
  const cardH = h - imageH;
  const accent = slide.accent_color || BRAND_COLORS.blue;

  return (
    <div
      style={{
        width: w,
        height: h,
        display: 'flex',
        flexDirection: 'column',
        background: BRAND_COLORS.white,
        fontFamily: 'Pretendard',
      }}
    >
      {/* 상단 이미지 */}
      <div style={{ width: w, height: imageH, display: 'flex', position: 'relative' }}>
        <PhotoFrame imageUrl={slide.bg_image_url} w={w} h={imageH} scrim="top" fallbackBg={BRAND_COLORS.navy} />
        <div
          style={{
            position: 'absolute',
            top: safeInset,
            left: safeInset,
            right: safeInset,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <LogoCorner variant="light" />
          <PageIndicator pageIndex={pageIndex} totalPages={totalPages} />
        </div>
      </div>

      {/* 하단 흰 카드 */}
      <div
        style={{
          width: w,
          height: cardH,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: `40px ${safeInset}px`,
          background: BRAND_COLORS.white,
        }}
      >
        {slide.eyebrow && (
          <div style={{ display: 'flex', marginBottom: 12 }}>
            <Eyebrow text={slide.eyebrow} color={accent} />
          </div>
        )}
        {slide.badge && (
          <div style={{ display: 'flex', marginBottom: 14 }}>
            <BadgePill text={slide.badge} surface={BRAND_COLORS.navy} />
          </div>
        )}
        <AccentLine width={36} height={3} color={accent} />
        <div style={{ display: 'flex', height: 14 }} />
        <Headline text={headlineText} size={headlineSize} color={BRAND_COLORS.navy} weight={800} />
        <div style={{ display: 'flex', height: 12 }} />
        <BodyBlock text={bodyText} size={bodySize} color={BRAND_COLORS.slate} />
        {slide.trust_row && slide.trust_row.length > 0 && (
          <div style={{ display: 'flex', marginTop: 16 }}>
            <TrustRow items={slide.trust_row} surface="#f0f6fb" ink={accent} />
          </div>
        )}
        {slide.price_chip && (
          <div style={{ display: 'flex', marginTop: 16 }}>
            <PriceChip text={slide.price_chip} />
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Detail — 전면 흰 카드 + body 중심 레이아웃
// ──────────────────────────────────────────────────────
function EditorialDetail({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
  const { w, h, safeInset } = format;
  const headlineText = truncateHeadline(slide.headline, 24);
  const bodyText = truncateBody(slide.body, 80);
  const headlineSize = getHeadlineFontSize(headlineText, 48);
  const bodySize = getBodyFontSize(bodyText, 22);
  const accent = slide.accent_color || BRAND_COLORS.blue;
  const hasImage = !!slide.bg_image_url;
  const imageH = hasImage ? Math.round(h * 0.36) : 0;

  return (
    <div
      style={{
        width: w,
        height: h,
        display: 'flex',
        flexDirection: 'column',
        background: BRAND_COLORS.white,
        fontFamily: 'Pretendard',
      }}
    >
      {hasImage && (
        <div style={{ width: w, height: imageH, display: 'flex', position: 'relative' }}>
          <PhotoFrame imageUrl={slide.bg_image_url} w={w} h={imageH} scrim="top" fallbackBg={BRAND_COLORS.navy} />
          <div
            style={{
              position: 'absolute',
              top: safeInset,
              left: safeInset,
              right: safeInset,
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <LogoCorner variant="light" />
            <PageIndicator pageIndex={pageIndex} totalPages={totalPages} />
          </div>
        </div>
      )}

      <div
        style={{
          width: w,
          height: h - imageH,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          padding: `${safeInset + 16}px ${safeInset}px`,
          background: BRAND_COLORS.white,
        }}
      >
        {!hasImage && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 32,
            }}
          >
            <LogoCorner variant="dark" />
            <PageIndicator pageIndex={pageIndex} totalPages={totalPages} color={BRAND_COLORS.slate} opacity={0.6} />
          </div>
        )}

        {slide.eyebrow && (
          <div style={{ display: 'flex', marginBottom: 12 }}>
            <Eyebrow text={slide.eyebrow} color={accent} />
          </div>
        )}
        {slide.badge && !slide.eyebrow && (
          <div style={{ display: 'flex', marginBottom: 12 }}>
            <BadgePill text={slide.badge} surface={BRAND_COLORS.navy} />
          </div>
        )}
        <AccentLine width={36} height={3} color={accent} />
        <div style={{ display: 'flex', height: 14 }} />
        <Headline text={headlineText} size={headlineSize} color={BRAND_COLORS.navy} weight={800} />
        <div style={{ display: 'flex', height: 16 }} />
        <BodyBlock text={bodyText} size={bodySize} color={BRAND_COLORS.slate} />

        {slide.tip && (
          <div style={{ display: 'flex', marginTop: 24 }}>
            <TipBlock text={slide.tip} />
          </div>
        )}
        {slide.warning && (
          <div style={{ display: 'flex', marginTop: 16 }}>
            <WarningBlock text={slide.warning} />
          </div>
        )}
        {slide.trust_row && slide.trust_row.length > 0 && (
          <div style={{ display: 'flex', marginTop: 20 }}>
            <TrustRow items={slide.trust_row} surface="#f0f6fb" ink={accent} />
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Tip — 흰 카드 + TipBlock 중심
// ──────────────────────────────────────────────────────
function EditorialTip({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
  const { w, h, safeInset } = format;
  const headlineText = truncateHeadline(slide.headline, 22);
  const tipText = slide.tip || slide.body || '';
  const headlineSize = getHeadlineFontSize(headlineText, 48);
  const accent = slide.accent_color || BRAND_COLORS.blue;

  return (
    <div
      style={{
        width: w,
        height: h,
        display: 'flex',
        flexDirection: 'column',
        background: '#f8fafc',
        fontFamily: 'Pretendard',
        padding: `${safeInset + 20}px ${safeInset}px`,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <LogoCorner variant="dark" />
        <PageIndicator pageIndex={pageIndex} totalPages={totalPages} color={BRAND_COLORS.slate} opacity={0.6} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
        <Eyebrow text={slide.eyebrow || 'PRO TIP'} color={accent} />
        <div style={{ display: 'flex', height: 14 }} />
        <Headline text={headlineText} size={headlineSize} color={BRAND_COLORS.navy} weight={800} />
        <div style={{ display: 'flex', height: 24 }} />
        <TipBlock text={tipText} label={slide.badge || '꿀팁'} />
        {slide.body && slide.tip && (
          <div style={{ display: 'flex', marginTop: 20 }}>
            <BodyBlock text={truncateBody(slide.body, 80)} size={20} color={BRAND_COLORS.slate} />
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Warning — Tip과 동일 레이아웃, WarningBlock 중심
// ──────────────────────────────────────────────────────
function EditorialWarning({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
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
        flexDirection: 'column',
        background: '#fef2f2',
        fontFamily: 'Pretendard',
        padding: `${safeInset + 20}px ${safeInset}px`,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <LogoCorner variant="dark" />
        <PageIndicator pageIndex={pageIndex} totalPages={totalPages} color={BRAND_COLORS.slate} opacity={0.6} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
        <Eyebrow text={slide.eyebrow || 'MISTAKE'} color={BRAND_COLORS.red} />
        <div style={{ display: 'flex', height: 14 }} />
        <Headline text={headlineText} size={headlineSize} color={BRAND_COLORS.navy} weight={800} />
        <div style={{ display: 'flex', height: 24 }} />
        <WarningBlock text={warnText} label={slide.badge || '주의'} />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// CTA — 악센트 배경 + 큰 버튼 + 가격
// ──────────────────────────────────────────────────────
function EditorialCTA({ slide, format, pageIndex, totalPages }: VariantProps): JSX.Element {
  const { w, h, safeInset } = format;
  const headlineText = truncateHeadline(slide.headline, 18);
  const bodyText = truncateBody(slide.body, 48);
  const headlineSize = getHeadlineFontSize(headlineText, 56);
  const accent = slide.accent_color || BRAND_COLORS.orange;

  return (
    <div
      style={{
        width: w,
        height: h,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        background: accent,
        fontFamily: 'Pretendard',
        padding: `${safeInset + 20}px ${safeInset}px`,
      }}
    >
      {slide.bg_image_url && (
        <PhotoFrame
          imageUrl={slide.bg_image_url}
          w={w}
          h={h}
          scrim="full"
          imageOpacity={0.35}
          fallbackBg={accent}
        />
      )}

      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 32,
        }}
      >
        <LogoCorner variant="light" />
        <PageIndicator pageIndex={pageIndex} totalPages={totalPages} />
      </div>

      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        {slide.price_chip && (
          <div style={{ display: 'flex', marginBottom: 20 }}>
            <PriceChip text={slide.price_chip} surface={BRAND_COLORS.white} ink={accent} size={26} />
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
        <div style={{ display: 'flex', height: 18 }} />
        <BodyBlock text={bodyText} size={22} color={BRAND_COLORS.white} opacity={0.92} align="center" />
        <div style={{ display: 'flex', height: 32 }} />
        <CTAButton
          label={slide.badge || '지금 확인하기'}
          surface={BRAND_COLORS.white}
          ink={accent}
        />
      </div>

      <div
        style={{
          position: 'relative',
          display: 'flex',
          justifyContent: 'center',
          color: BRAND_COLORS.white,
          fontSize: 11,
          fontWeight: 400,
          letterSpacing: 2,
          opacity: 0.85,
          marginTop: 16,
        }}
      >
        yeosonam.com
      </div>
    </div>
  );
}

export const EditorialFamily: FamilyRegistry = {
  family: 'editorial',
  variants: {
    cover: EditorialCover,
    detail: EditorialDetail,
    tip: EditorialTip,
    warning: EditorialWarning,
    cta: EditorialCTA,
  },
};
