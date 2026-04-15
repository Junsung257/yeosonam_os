'use client';

import { TemplateProps } from './types';
import { BRAND_COLORS, BRAND_FONTS, getHeadlineFontSize, getBodyFontSize, truncateHeadline, truncateBody } from '@/lib/card-news/tokens';

/**
 * Magazine — 풀이미지 + 큰 번호(01, 02) + 빨간 배지
 * 베스트 매치: 스토리/시리즈, 효도여행, 일정별 슬라이드
 */
export default function Magazine(props: TemplateProps) {
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
  const headlineSize = getHeadlineFontSize(headlineText, variant === 'cover' ? 50 : 40) * s;
  const bodySize = getBodyFontSize(bodyText, 18) * s;
  const padding = 40 * s;
  const numberSize = 96 * s;

  const pageNumber = pageIndex ? String(pageIndex).padStart(2, '0') : '01';

  return (
    <div
      className="card-news-export-slide relative overflow-hidden rounded-lg"
      style={{ width: `${w}px`, height: `${h}px`, background: BRAND_COLORS.black, fontFamily: BRAND_FONTS.sans }}
    >
      {/* 풀블리드 배경 이미지 */}
      {bgImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bgImageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          crossOrigin="anonymous"
        />
      ) : (
        <div className="absolute inset-0" style={{ backgroundColor: BRAND_COLORS.navy }} />
      )}

      {/* 어두운 그라데이션 (하단 70%만) */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.7) 70%, rgba(0,0,0,0.95) 100%)',
        }}
      />

      {/* 큰 번호 (왼쪽 상단, 매거진 스타일) */}
      <div style={{
        position: 'absolute',
        top: `${padding * 0.6}px`,
        left: `${padding}px`,
        fontSize: `${numberSize}px`,
        fontWeight: 900,
        color: BRAND_COLORS.white,
        opacity: 0.18,
        lineHeight: 0.85,
        letterSpacing: '-0.05em',
        fontFamily: BRAND_FONTS.serif,
      }}>
        {pageNumber}
      </div>

      {/* 컨텐츠 */}
      <div
        className="relative z-10 flex flex-col h-full"
        style={{ padding: `${padding}px` }}
      >
        {/* 상단: 로고 (오른쪽 정렬) */}
        <div className="flex items-center justify-end" style={{ fontSize: `${10 * s}px` }}>
          <span style={{
            color: BRAND_COLORS.white,
            fontWeight: 700,
            letterSpacing: '0.15em',
            opacity: 0.85,
            textShadow: '0 1px 4px rgba(0,0,0,0.3)',
          }}>
            YEOSONAM
          </span>
        </div>

        <div className="flex-1" />

        {/* 하단: 배지 + 헤드라인 + 본문 */}
        <div>
          {/* 매거진 스타일 라벨: "ISSUE NO. 01" 또는 사용자 정의 배지 */}
          <div className="flex items-center" style={{ marginBottom: `${14 * s}px`, gap: `${10 * s}px` }}>
            {/* 빨간 배지 */}
            <div style={{
              padding: `${4 * s}px ${10 * s}px`,
              backgroundColor: BRAND_COLORS.red,
              color: BRAND_COLORS.white,
              fontSize: `${11 * s}px`,
              fontWeight: 800,
              letterSpacing: '0.12em',
              borderRadius: `${2 * s}px`,
            }}>
              {badge || `NO. ${pageNumber}`}
            </div>
            {/* 빨간 라인 (장식) */}
            <div style={{
              flex: 1,
              height: `${1 * s}px`,
              backgroundColor: BRAND_COLORS.red,
              opacity: 0.5,
            }} />
          </div>

          {/* 헤드라인 (세리프 강조) */}
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
                marginBottom: `${14}px`,
                letterSpacing: '-0.025em',
                fontFamily: BRAND_FONTS.serif,
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
              marginBottom: `${14 * s}px`,
              letterSpacing: '-0.025em',
              fontFamily: BRAND_FONTS.serif,
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
                opacity: 0.92,
                lineHeight: 1.55,
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
            }}>
              {bodyText}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
