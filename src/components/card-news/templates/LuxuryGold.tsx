'use client';

import { TemplateProps } from './types';
import { BRAND_COLORS, BRAND_FONTS, getHeadlineFontSize, getBodyFontSize, truncateHeadline, truncateBody } from '@/lib/card-news/tokens';

/**
 * Luxury Gold — 블랙 배경 + 골드 보더 + 세리프
 * 베스트 매치: 프리미엄, 5성급, 신혼여행, 럭셔리
 */
export default function LuxuryGold(props: TemplateProps) {
  const {
    headline, body, bgImageUrl, badge, variant,
    pageIndex, totalPages, ratio, isPreview,
    onUpdateHeadline, onUpdateBody,
  } = props;

  const scale = isPreview ? Math.min(ratio.w, ratio.h) <= 200 ? 1 : 200 / Math.max(ratio.w, ratio.h) : 1;
  const w = ratio.w * (isPreview ? scale : 1);
  const h = ratio.h * (isPreview ? scale : 1);
  const s = isPreview ? scale : 1;

  const headlineText = truncateHeadline(headline, 20);
  const bodyText = truncateBody(body, 50);
  const headlineSize = getHeadlineFontSize(headlineText, variant === 'cover' ? 48 : 40) * s;
  const bodySize = getBodyFontSize(bodyText, 19) * s;
  const padding = 48 * s;
  const borderInset = 18 * s;

  return (
    <div
      className="card-news-export-slide relative overflow-hidden rounded-lg"
      style={{ width: `${w}px`, height: `${h}px`, background: BRAND_COLORS.black, fontFamily: BRAND_FONTS.serif }}
    >
      {/* 배경 이미지 (어두운 톤) */}
      {bgImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bgImageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          crossOrigin="anonymous"
          style={{ opacity: 0.42, filter: 'brightness(0.6) contrast(1.1)' }}
        />
      )}

      {/* 골드 보더 (안쪽 외곽선) */}
      <div style={{
        position: 'absolute',
        top: `${borderInset}px`,
        left: `${borderInset}px`,
        right: `${borderInset}px`,
        bottom: `${borderInset}px`,
        border: `${1.5 * s}px solid ${BRAND_COLORS.gold}`,
        opacity: 0.7,
        pointerEvents: 'none',
      }} />

      {/* 컨텐츠 */}
      <div
        className="relative z-10 flex flex-col h-full"
        style={{ padding: `${padding}px` }}
      >
        {/* 상단: 골드 라벨 */}
        <div className="flex items-center justify-between" style={{ fontSize: `${10 * s}px` }}>
          <span style={{
            color: BRAND_COLORS.gold,
            fontWeight: 600,
            letterSpacing: '0.25em',
            fontFamily: BRAND_FONTS.sans,
          }}>
            YEOSONAM • PREMIUM
          </span>
          {pageIndex && totalPages && (
            <span style={{ color: BRAND_COLORS.gold, opacity: 0.7, letterSpacing: '0.15em', fontFamily: BRAND_FONTS.sans }}>
              {String(pageIndex).padStart(2, '0')} / {String(totalPages).padStart(2, '0')}
            </span>
          )}
        </div>

        {/* 중앙 정렬 */}
        <div className="flex-1 flex flex-col justify-center" style={{ textAlign: 'center' }}>
          {/* 골드 배지 */}
          {badge && (
            <div style={{
              display: 'inline-block',
              alignSelf: 'center',
              padding: `${5 * s}px ${14 * s}px`,
              border: `${1 * s}px solid ${BRAND_COLORS.gold}`,
              color: BRAND_COLORS.gold,
              fontSize: `${11 * s}px`,
              fontWeight: 600,
              letterSpacing: '0.2em',
              marginBottom: `${24 * s}px`,
              fontFamily: BRAND_FONTS.sans,
            }}>
              {badge}
            </div>
          )}

          {/* 작은 골드 장식선 (헤드라인 위) */}
          <div style={{
            width: `${40 * s}px`,
            height: `${1 * s}px`,
            backgroundColor: BRAND_COLORS.gold,
            alignSelf: 'center',
            marginBottom: `${24 * s}px`,
          }} />

          {/* 헤드라인 (세리프 이탤릭) */}
          {!isPreview && onUpdateHeadline ? (
            <h2
              contentEditable
              suppressContentEditableWarning
              onBlur={e => onUpdateHeadline?.(e.currentTarget.innerText || '')}
              className="outline-none focus:bg-yellow-50/10 rounded leading-tight"
              style={{
                color: BRAND_COLORS.white,
                fontSize: `${headlineSize}px`,
                fontWeight: 700,
                lineHeight: 1.2,
                marginBottom: `${20}px`,
                letterSpacing: '-0.01em',
                fontFamily: BRAND_FONTS.serif,
                fontStyle: 'italic',
              }}
            >
              {headlineText}
            </h2>
          ) : (
            <h2 style={{
              color: BRAND_COLORS.white,
              fontSize: `${headlineSize}px`,
              fontWeight: 700,
              lineHeight: 1.2,
              marginBottom: `${20 * s}px`,
              letterSpacing: '-0.01em',
              fontFamily: BRAND_FONTS.serif,
              fontStyle: 'italic',
            }}>
              {headlineText}
            </h2>
          )}

          {/* 본문 */}
          {!isPreview && onUpdateBody ? (
            <p
              contentEditable
              suppressContentEditableWarning
              onBlur={e => onUpdateBody?.(e.currentTarget.innerText || '')}
              className="outline-none focus:bg-yellow-50/10 rounded"
              style={{
                color: BRAND_COLORS.white,
                fontSize: `${bodySize}px`,
                opacity: 0.85,
                lineHeight: 1.6,
                fontFamily: BRAND_FONTS.sans,
                fontWeight: 300,
                letterSpacing: '0.02em',
              }}
            >
              {bodyText}
            </p>
          ) : (
            <p style={{
              color: BRAND_COLORS.white,
              fontSize: `${bodySize}px`,
              opacity: 0.85,
              lineHeight: 1.6,
              fontFamily: BRAND_FONTS.sans,
              fontWeight: 300,
              letterSpacing: '0.02em',
            }}>
              {bodyText}
            </p>
          )}

          {/* 하단 골드 장식선 */}
          <div style={{
            width: `${40 * s}px`,
            height: `${1 * s}px`,
            backgroundColor: BRAND_COLORS.gold,
            alignSelf: 'center',
            marginTop: `${24 * s}px`,
          }} />
        </div>

        {/* 하단 브랜딩 */}
        <div style={{
          textAlign: 'center',
          fontSize: `${9 * s}px`,
          color: BRAND_COLORS.gold,
          opacity: 0.6,
          letterSpacing: '0.2em',
          fontFamily: BRAND_FONTS.sans,
        }}>
          yeosonam.com
        </div>
      </div>
    </div>
  );
}
