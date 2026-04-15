'use client';

import { TemplateProps } from './types';
import { BRAND_COLORS, BRAND_FONTS, getHeadlineFontSize, getBodyFontSize, truncateHeadline, truncateBody } from '@/lib/card-news/tokens';

/**
 * Dark Cinematic — 풀블리드 이미지 + 하단 그라데이션 + 오렌지 악센트
 * 베스트 매치: 자연 풍경, 감성 여행, 야경, 모험
 */
export default function DarkCinematic(props: TemplateProps) {
  const {
    headline, body, bgImageUrl, badge, variant,
    pageIndex, totalPages, ratio, isPreview,
    onUpdateHeadline, onUpdateBody,
  } = props;

  const scale = isPreview ? Math.min(ratio.w, ratio.h) <= 200 ? 1 : 200 / Math.max(ratio.w, ratio.h) : 1;
  const w = ratio.w * (isPreview ? scale : 1);
  const h = ratio.h * (isPreview ? scale : 1);

  const headlineText = truncateHeadline(headline, 20);
  const bodyText = truncateBody(body, 50);
  const headlineSize = getHeadlineFontSize(headlineText, variant === 'cover' ? 56 : 44) * (isPreview ? scale : 1);
  const bodySize = getBodyFontSize(bodyText, 22) * (isPreview ? scale : 1);
  const padding = isPreview ? 12 * scale : 56;

  return (
    <div
      className="card-news-export-slide relative overflow-hidden rounded-lg"
      style={{ width: `${w}px`, height: `${h}px`, background: BRAND_COLORS.black, fontFamily: BRAND_FONTS.sans }}
    >
      {/* 배경 이미지 */}
      {bgImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bgImageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          crossOrigin="anonymous"
        />
      )}

      {/* 어두운 그라데이션 오버레이 (위에서 아래로) */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.05) 35%, rgba(0,0,0,0.6) 75%, rgba(0,0,0,0.85) 100%)',
        }}
      />

      {/* 컨텐츠 컨테이너 */}
      <div
        className="relative z-10 flex flex-col h-full"
        style={{ padding: `${padding}px` }}
      >
        {/* 상단: 로고 + 페이지 인디케이터 */}
        <div className="flex items-center justify-between" style={{ fontSize: `${10 * (isPreview ? scale : 1)}px` }}>
          <span style={{
            color: BRAND_COLORS.white,
            fontWeight: 700,
            letterSpacing: '0.15em',
            opacity: 0.85,
          }}>
            YEOSONAM
          </span>
          {pageIndex && totalPages && (
            <span style={{ color: BRAND_COLORS.white, opacity: 0.6, letterSpacing: '0.1em' }}>
              {String(pageIndex).padStart(2, '0')} / {String(totalPages).padStart(2, '0')}
            </span>
          )}
        </div>

        {/* 중간 빈 공간 */}
        <div className="flex-1" />

        {/* 하단: 배지 + 헤드라인 + 악센트 라인 + 본문 */}
        <div>
          {/* 배지 (오렌지) */}
          {badge && (
            <div className="mb-3" style={{
              display: 'inline-block',
              padding: `${4 * (isPreview ? scale : 1)}px ${10 * (isPreview ? scale : 1)}px`,
              backgroundColor: BRAND_COLORS.orange,
              color: BRAND_COLORS.white,
              fontSize: `${11 * (isPreview ? scale : 1)}px`,
              fontWeight: 700,
              letterSpacing: '0.1em',
              borderRadius: `${3 * (isPreview ? scale : 1)}px`,
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
              className="outline-none focus:bg-yellow-50/10 rounded leading-tight"
              style={{
                color: BRAND_COLORS.white,
                fontSize: `${headlineSize}px`,
                fontWeight: 800,
                lineHeight: 1.15,
                marginBottom: `${16}px`,
                letterSpacing: '-0.02em',
              }}
            >
              {headlineText}
            </h2>
          ) : (
            <h2 style={{
              color: BRAND_COLORS.white,
              fontSize: `${headlineSize}px`,
              fontWeight: 800,
              lineHeight: 1.15,
              marginBottom: `${16 * (isPreview ? scale : 1)}px`,
              letterSpacing: '-0.02em',
            }}>
              {headlineText}
            </h2>
          )}

          {/* 오렌지 악센트 라인 */}
          <div style={{
            width: `${48 * (isPreview ? scale : 1)}px`,
            height: `${3 * (isPreview ? scale : 1)}px`,
            backgroundColor: BRAND_COLORS.orange,
            marginBottom: `${16 * (isPreview ? scale : 1)}px`,
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
                opacity: 0.95,
                lineHeight: 1.5,
              }}
            >
              {bodyText}
            </p>
          ) : (
            <p style={{
              color: BRAND_COLORS.white,
              fontSize: `${bodySize}px`,
              opacity: 0.95,
              lineHeight: 1.5,
            }}>
              {bodyText}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
