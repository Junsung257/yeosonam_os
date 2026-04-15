'use client';

import { TemplateProps } from './types';
import { BRAND_COLORS, BRAND_FONTS, getHeadlineFontSize, getBodyFontSize, truncateHeadline, truncateBody } from '@/lib/card-news/tokens';

/**
 * Bold Gradient — 네이비→블루→골드 그라데이션 + 중앙 대형 헤드라인
 * 베스트 매치: 가성비 특가, 가격 강조, 마감임박
 */
export default function BoldGradient(props: TemplateProps) {
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
  const headlineSize = getHeadlineFontSize(headlineText, variant === 'cover' ? 64 : 48) * s;
  const bodySize = getBodyFontSize(bodyText, 22) * s;
  const padding = 48 * s;

  return (
    <div
      className="card-news-export-slide relative overflow-hidden rounded-lg"
      style={{
        width: `${w}px`,
        height: `${h}px`,
        background: `linear-gradient(135deg, ${BRAND_COLORS.navy} 0%, ${BRAND_COLORS.blue} 60%, ${BRAND_COLORS.gold} 130%)`,
        fontFamily: BRAND_FONTS.sans,
      }}
    >
      {/* 옵션: 배경 이미지가 있으면 낮은 투명도로 오버레이 */}
      {bgImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bgImageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          crossOrigin="anonymous"
          style={{ opacity: 0.18, mixBlendMode: 'overlay' }}
        />
      )}

      {/* 장식 원 (디자인 포인트) */}
      <div style={{
        position: 'absolute',
        top: `-${w * 0.2}px`,
        right: `-${w * 0.2}px`,
        width: `${w * 0.5}px`,
        height: `${w * 0.5}px`,
        borderRadius: '50%',
        backgroundColor: BRAND_COLORS.gold,
        opacity: 0.12,
      }} />
      <div style={{
        position: 'absolute',
        bottom: `-${w * 0.15}px`,
        left: `-${w * 0.15}px`,
        width: `${w * 0.35}px`,
        height: `${w * 0.35}px`,
        borderRadius: '50%',
        backgroundColor: BRAND_COLORS.white,
        opacity: 0.06,
      }} />

      {/* 컨텐츠 */}
      <div
        className="relative z-10 flex flex-col h-full"
        style={{ padding: `${padding}px` }}
      >
        {/* 상단 */}
        <div className="flex items-center justify-between" style={{ fontSize: `${10 * s}px` }}>
          <span style={{
            color: BRAND_COLORS.white,
            fontWeight: 700,
            letterSpacing: '0.15em',
            opacity: 0.9,
          }}>
            YEOSONAM
          </span>
          {pageIndex && totalPages && (
            <span style={{ color: BRAND_COLORS.gold, opacity: 0.95, letterSpacing: '0.1em', fontWeight: 600 }}>
              {String(pageIndex).padStart(2, '0')} / {String(totalPages).padStart(2, '0')}
            </span>
          )}
        </div>

        {/* 중앙 정렬된 메인 텍스트 */}
        <div className="flex-1 flex flex-col justify-center" style={{ textAlign: 'center' }}>
          {/* 골드 배지 */}
          {badge && (
            <div style={{
              display: 'inline-block',
              alignSelf: 'center',
              padding: `${5 * s}px ${14 * s}px`,
              backgroundColor: BRAND_COLORS.gold,
              color: BRAND_COLORS.navy,
              fontSize: `${12 * s}px`,
              fontWeight: 800,
              letterSpacing: '0.1em',
              borderRadius: `${999}px`,
              marginBottom: `${20 * s}px`,
            }}>
              {badge}
            </div>
          )}

          {/* 헤드라인 (대형) */}
          {!isPreview && onUpdateHeadline ? (
            <h2
              contentEditable
              suppressContentEditableWarning
              onBlur={e => onUpdateHeadline?.(e.currentTarget.innerText || '')}
              className="outline-none focus:bg-yellow-50/10 rounded leading-tight"
              style={{
                color: BRAND_COLORS.white,
                fontSize: `${headlineSize}px`,
                fontWeight: 900,
                lineHeight: 1.1,
                marginBottom: `${20}px`,
                letterSpacing: '-0.03em',
                textShadow: '0 2px 12px rgba(0,0,0,0.2)',
              }}
            >
              {headlineText}
            </h2>
          ) : (
            <h2 style={{
              color: BRAND_COLORS.white,
              fontSize: `${headlineSize}px`,
              fontWeight: 900,
              lineHeight: 1.1,
              marginBottom: `${20 * s}px`,
              letterSpacing: '-0.03em',
              textShadow: '0 2px 12px rgba(0,0,0,0.2)',
            }}>
              {headlineText}
            </h2>
          )}

          {/* 골드 구분선 */}
          <div style={{
            width: `${60 * s}px`,
            height: `${2 * s}px`,
            backgroundColor: BRAND_COLORS.gold,
            alignSelf: 'center',
            marginBottom: `${20 * s}px`,
          }} />

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
                opacity: 0.92,
                lineHeight: 1.55,
                fontWeight: 500,
              }}
            >
              {bodyText}
            </p>
          ) : (
            <p style={{
              color: BRAND_COLORS.white,
              fontSize: `${bodySize}px`,
              opacity: 0.92,
              lineHeight: 1.55,
              fontWeight: 500,
            }}>
              {bodyText}
            </p>
          )}
        </div>

        {/* 하단 브랜딩 */}
        <div style={{
          textAlign: 'center',
          fontSize: `${9 * s}px`,
          color: BRAND_COLORS.white,
          opacity: 0.5,
          letterSpacing: '0.1em',
        }}>
          yeosonam.com
        </div>
      </div>
    </div>
  );
}
