'use client';

import { TemplateProps } from './types';
import { BRAND_COLORS, BRAND_FONTS, getHeadlineFontSize, getBodyFontSize, truncateHeadline, truncateBody } from '@/lib/card-news/tokens';

/**
 * Clean White — 상단 60% 이미지 + 하단 40% 흰 카드 (Magazine 스타일)
 * 베스트 매치: 정보성, 가이드, 가성비 패키지
 */
export default function CleanWhite(props: TemplateProps) {
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
  const headlineSize = getHeadlineFontSize(headlineText, variant === 'cover' ? 44 : 36) * s;
  const bodySize = getBodyFontSize(bodyText, 18) * s;

  const imageHeight = h * 0.58;  // 상단 58%
  const cardPadding = 36 * s;

  return (
    <div
      className="card-news-export-slide relative overflow-hidden rounded-lg"
      style={{ width: `${w}px`, height: `${h}px`, background: BRAND_COLORS.softBg, fontFamily: BRAND_FONTS.sans }}
    >
      {/* 상단 이미지 영역 */}
      <div
        className="absolute top-0 left-0 right-0 overflow-hidden"
        style={{ height: `${imageHeight}px`, backgroundColor: BRAND_COLORS.navy }}
      >
        {bgImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bgImageUrl}
            alt=""
            className="w-full h-full object-cover"
            crossOrigin="anonymous"
          />
        )}
        {/* 상단 로고 + 페이지 인디케이터 (이미지 위) */}
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-between"
          style={{ padding: `${20 * s}px ${cardPadding}px`, fontSize: `${10 * s}px` }}
        >
          <span style={{
            color: BRAND_COLORS.white,
            fontWeight: 700,
            letterSpacing: '0.15em',
            textShadow: '0 1px 4px rgba(0,0,0,0.4)',
          }}>
            YEOSONAM
          </span>
          {pageIndex && totalPages && (
            <span style={{
              color: BRAND_COLORS.white,
              opacity: 0.9,
              letterSpacing: '0.1em',
              textShadow: '0 1px 4px rgba(0,0,0,0.4)',
            }}>
              {String(pageIndex).padStart(2, '0')} / {String(totalPages).padStart(2, '0')}
            </span>
          )}
        </div>
      </div>

      {/* 하단 흰 카드 영역 */}
      <div
        className="absolute bottom-0 left-0 right-0 flex flex-col"
        style={{
          top: `${imageHeight - 24 * s}px`,
          backgroundColor: BRAND_COLORS.white,
          borderTopLeftRadius: `${24 * s}px`,
          borderTopRightRadius: `${24 * s}px`,
          padding: `${cardPadding}px`,
          boxShadow: '0 -8px 24px rgba(0,0,0,0.08)',
        }}
      >
        {/* 배지 (네이비) */}
        {badge && (
          <div className="mb-2" style={{
            display: 'inline-block',
            alignSelf: 'flex-start',
            padding: `${4 * s}px ${10 * s}px`,
            backgroundColor: BRAND_COLORS.navy,
            color: BRAND_COLORS.white,
            fontSize: `${10 * s}px`,
            fontWeight: 700,
            letterSpacing: '0.1em',
            borderRadius: `${3 * s}px`,
            marginBottom: `${10 * s}px`,
          }}>
            {badge}
          </div>
        )}

        {/* 헤드라인 */}
        {!isPreview && onUpdateHeadline ? (
          <h2
            contentEditable
            suppressContentEditableWarning
            onBlur={e => onUpdateHeadline?.(e.currentTarget.innerText || '')}
            className="outline-none focus:bg-yellow-50 rounded leading-tight"
            style={{
              color: BRAND_COLORS.navy,
              fontSize: `${headlineSize}px`,
              fontWeight: 800,
              lineHeight: 1.2,
              marginBottom: `${12}px`,
              letterSpacing: '-0.02em',
            }}
          >
            {headlineText}
          </h2>
        ) : (
          <h2 style={{
            color: BRAND_COLORS.navy,
            fontSize: `${headlineSize}px`,
            fontWeight: 800,
            lineHeight: 1.2,
            marginBottom: `${12 * s}px`,
            letterSpacing: '-0.02em',
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
            className="outline-none focus:bg-yellow-50 rounded"
            style={{
              color: BRAND_COLORS.slate,
              fontSize: `${bodySize}px`,
              lineHeight: 1.55,
            }}
          >
            {bodyText}
          </p>
        ) : (
          <p style={{
            color: BRAND_COLORS.slate,
            fontSize: `${bodySize}px`,
            lineHeight: 1.55,
          }}>
            {bodyText}
          </p>
        )}

        {/* 하단 액센트 (블루 라인) */}
        <div className="flex-1" />
        <div style={{
          width: `${36 * s}px`,
          height: `${3 * s}px`,
          backgroundColor: BRAND_COLORS.blue,
          marginTop: `${12 * s}px`,
        }} />
      </div>
    </div>
  );
}
