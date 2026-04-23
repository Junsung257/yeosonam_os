/**
 * Satori-safe 카드뉴스 템플릿 (5종 전체)
 *
 * Satori 제약:
 *  - Tailwind 미지원 → 인라인 style 객체만 사용
 *  - 여러 자식이 있는 div는 반드시 display: 'flex' 명시
 *  - filter / mixBlendMode / 복잡 box-shadow 미지원
 *  - 이미지는 원격 URL (fetch 후 base64 권장) 또는 data URL만 가능
 *  - linear-gradient / radial-gradient, border-radius, opacity, textShadow: 지원
 *
 * 전략: 5개 family가 모두 Satori-safe. TEMPLATE_META[id].satoriReady 기반으로 판정.
 * `isSatoriSupported()`는 레거시 호환용 — 내부적으로 TEMPLATE_META 조회.
 */
import React from 'react';
import {
  BRAND_COLORS,
  getHeadlineFontSize,
  getBodyFontSize,
  truncateHeadline,
  truncateBody,
  TemplateId,
  TEMPLATE_META,
} from './tokens';

export interface SatoriTemplateInput {
  templateId: TemplateId;
  headline: string;
  body: string;
  bgImageUrl?: string;
  badge?: string | null;
  variant: 'cover' | 'content' | 'cta';
  pageIndex?: number;
  totalPages?: number;
  ratio: { w: number; h: number };
}

/** 이 템플릿을 Satori로 렌더 가능한가? (TEMPLATE_META 기반) */
export function isSatoriSupported(templateId: string | undefined): boolean {
  if (!templateId) return false;
  return TEMPLATE_META[templateId as TemplateId]?.satoriReady === true;
}

/** Satori 템플릿 라우팅 */
export function buildSatoriElement(input: SatoriTemplateInput): JSX.Element {
  switch (input.templateId) {
    case 'clean_white':
      return <CleanWhiteSatori {...input} />;
    case 'luxury_gold':
      return <LuxuryGoldSatori {...input} />;
    case 'dark_cinematic':
      return <DarkCinematicSatori {...input} />;
    case 'bold_gradient':
      return <BoldGradientSatori {...input} />;
    case 'magazine':
      return <MagazineSatori {...input} />;
    default:
      return <CleanWhiteSatori {...input} />;
  }
}

// ──────────────────────────────────────────────────────
// 공통 헬퍼 — 페이지 인디케이터 / 로고
// ──────────────────────────────────────────────────────
function formatPage(p?: number, t?: number): string | null {
  if (!p || !t) return null;
  return `${String(p).padStart(2, '0')} / ${String(t).padStart(2, '0')}`;
}

// ──────────────────────────────────────────────────────
// CleanWhite — 상단 이미지(58%) + 하단 흰 카드(42%)
// ──────────────────────────────────────────────────────
function CleanWhiteSatori(props: SatoriTemplateInput): JSX.Element {
  const { headline, body, bgImageUrl, badge, variant, pageIndex, totalPages, ratio } = props;
  const { w, h } = ratio;
  const headlineText = truncateHeadline(headline, 20);
  const bodyText = truncateBody(body, 50);
  const headlineSize = getHeadlineFontSize(headlineText, variant === 'cover' ? 56 : 44);
  const bodySize = getBodyFontSize(bodyText, 22);
  const imageH = Math.round(h * 0.58);
  const cardH = h - imageH;
  const pageLabel = formatPage(pageIndex, totalPages);

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
      {/* 상단 이미지 영역 */}
      <div
        style={{
          width: w,
          height: imageH,
          display: 'flex',
          position: 'relative',
          background: bgImageUrl ? 'transparent' : BRAND_COLORS.navy,
        }}
      >
        {bgImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
          <img
            src={bgImageUrl}
            width={w}
            height={imageH}
            style={{ objectFit: 'cover', width: w, height: imageH }}
          />
        )}
        {/* 상단 scrim (로고 가독성 확보) */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: w,
            height: 120,
            display: 'flex',
            background: 'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 100%)',
          }}
        />
        {/* 로고 — 이미지 위 좌상단 */}
        <div
          style={{
            position: 'absolute',
            top: 32,
            left: 40,
            display: 'flex',
            color: BRAND_COLORS.white,
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: 3,
          }}
        >
          YEOSONAM
        </div>
        {/* 페이지 번호 — 우상단 */}
        {pageLabel && (
          <div
            style={{
              position: 'absolute',
              top: 32,
              right: 40,
              display: 'flex',
              color: BRAND_COLORS.white,
              fontSize: 12,
              fontWeight: 400,
              letterSpacing: 2,
            }}
          >
            {pageLabel}
          </div>
        )}
      </div>

      {/* 하단 카드 */}
      <div
        style={{
          width: w,
          height: cardH,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '40px 48px',
          background: BRAND_COLORS.white,
        }}
      >
        {badge && (
          <div
            style={{
              display: 'flex',
              alignSelf: 'flex-start',
              padding: '4px 10px',
              background: BRAND_COLORS.navy,
              color: BRAND_COLORS.white,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1.5,
              marginBottom: 14,
              borderRadius: 3,
            }}
          >
            {badge}
          </div>
        )}
        <div
          style={{
            display: 'flex',
            width: 36,
            height: 2,
            background: BRAND_COLORS.blue,
            marginBottom: 16,
          }}
        />
        <div
          style={{
            display: 'flex',
            color: BRAND_COLORS.navy,
            fontSize: headlineSize,
            fontWeight: 700,
            lineHeight: 1.25,
            letterSpacing: -0.5,
            marginBottom: 14,
          }}
        >
          {headlineText}
        </div>
        <div
          style={{
            display: 'flex',
            color: BRAND_COLORS.slate,
            fontSize: bodySize,
            fontWeight: 400,
            lineHeight: 1.55,
          }}
        >
          {bodyText}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// LuxuryGold — 블랙 + 골드 보더 + 중앙 정렬
// ──────────────────────────────────────────────────────
function LuxuryGoldSatori(props: SatoriTemplateInput): JSX.Element {
  const { headline, body, bgImageUrl, badge, variant, pageIndex, totalPages, ratio } = props;
  const { w, h } = ratio;
  const headlineText = truncateHeadline(headline, 20);
  const bodyText = truncateBody(body, 50);
  const headlineSize = getHeadlineFontSize(headlineText, variant === 'cover' ? 52 : 42);
  const bodySize = getBodyFontSize(bodyText, 20);
  const borderInset = 22;
  const pageLabel = formatPage(pageIndex, totalPages);

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
      {bgImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
        <img
          src={bgImageUrl}
          width={w}
          height={h}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: w,
            height: h,
            objectFit: 'cover',
            opacity: 0.42,
          }}
        />
      )}

      {/* 골드 보더 */}
      <div
        style={{
          position: 'absolute',
          top: borderInset,
          left: borderInset,
          width: w - borderInset * 2,
          height: h - borderInset * 2,
          display: 'flex',
          border: `1.5px solid ${BRAND_COLORS.gold}`,
          opacity: 0.7,
        }}
      />

      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          display: 'flex',
          flexDirection: 'column',
          padding: 56,
        }}
      >
        {/* 상단: 골드 라벨 + 페이지 번호 */}
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
              color: BRAND_COLORS.gold,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 4,
            }}
          >
            YEOSONAM · PREMIUM
          </div>
          {pageLabel && (
            <div
              style={{
                display: 'flex',
                color: BRAND_COLORS.gold,
                opacity: 0.7,
                fontSize: 11,
                fontWeight: 400,
                letterSpacing: 2,
              }}
            >
              {pageLabel}
            </div>
          )}
        </div>

        {/* 중앙 */}
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
          {badge && (
            <div
              style={{
                display: 'flex',
                padding: '6px 16px',
                border: `1px solid ${BRAND_COLORS.gold}`,
                color: BRAND_COLORS.gold,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 3,
                marginBottom: 22,
              }}
            >
              {badge}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              width: 40,
              height: 1,
              background: BRAND_COLORS.gold,
              marginBottom: 22,
            }}
          />

          <div
            style={{
              display: 'flex',
              color: BRAND_COLORS.white,
              fontSize: headlineSize,
              fontWeight: 700,
              lineHeight: 1.2,
              letterSpacing: -0.3,
              marginBottom: 18,
              textAlign: 'center',
            }}
          >
            {headlineText}
          </div>

          <div
            style={{
              display: 'flex',
              color: BRAND_COLORS.white,
              fontSize: bodySize,
              fontWeight: 400,
              lineHeight: 1.6,
              opacity: 0.88,
              letterSpacing: 0.3,
              textAlign: 'center',
            }}
          >
            {bodyText}
          </div>

          <div
            style={{
              display: 'flex',
              width: 40,
              height: 1,
              background: BRAND_COLORS.gold,
              marginTop: 22,
            }}
          />
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            color: BRAND_COLORS.gold,
            opacity: 0.6,
            fontSize: 9,
            fontWeight: 400,
            letterSpacing: 3,
          }}
        >
          yeosonam.com
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// DarkCinematic — 풀블리드 이미지 + 강한 scrim + 오렌지 악센트
// ──────────────────────────────────────────────────────
function DarkCinematicSatori(props: SatoriTemplateInput): JSX.Element {
  const { headline, body, bgImageUrl, badge, variant, pageIndex, totalPages, ratio } = props;
  const { w, h } = ratio;
  const headlineText = truncateHeadline(headline, 20);
  const bodyText = truncateBody(body, 50);
  const headlineSize = getHeadlineFontSize(headlineText, variant === 'cover' ? 60 : 46);
  const bodySize = getBodyFontSize(bodyText, 22);
  const padding = 56;
  const pageLabel = formatPage(pageIndex, totalPages);

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
      {bgImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
        <img
          src={bgImageUrl}
          width={w}
          height={h}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: w,
            height: h,
            objectFit: 'cover',
          }}
        />
      )}

      {/* 강한 U자형 scrim — 상단/하단 둘 다 어둡게, 중앙 투명 */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: w,
          height: h,
          display: 'flex',
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 28%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0.75) 85%, rgba(0,0,0,0.92) 100%)',
        }}
      />

      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          display: 'flex',
          flexDirection: 'column',
          padding,
        }}
      >
        {/* 상단: 로고 + 페이지 번호 */}
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
              color: BRAND_COLORS.white,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 3,
              opacity: 0.95,
            }}
          >
            YEOSONAM
          </div>
          {pageLabel && (
            <div
              style={{
                display: 'flex',
                color: BRAND_COLORS.white,
                opacity: 0.75,
                fontSize: 11,
                fontWeight: 400,
                letterSpacing: 2,
              }}
            >
              {pageLabel}
            </div>
          )}
        </div>

        {/* spacer */}
        <div style={{ flex: 1, display: 'flex' }} />

        {/* 하단: 배지 + 헤드라인 + 악센트 + 본문 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {badge && (
            <div
              style={{
                display: 'flex',
                alignSelf: 'flex-start',
                padding: '5px 12px',
                background: BRAND_COLORS.orange,
                color: BRAND_COLORS.white,
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 1.5,
                borderRadius: 3,
                marginBottom: 14,
              }}
            >
              {badge}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              color: BRAND_COLORS.white,
              fontSize: headlineSize,
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: -0.6,
              marginBottom: 16,
            }}
          >
            {headlineText}
          </div>

          {/* 오렌지 악센트 라인 */}
          <div
            style={{
              display: 'flex',
              width: 48,
              height: 3,
              background: BRAND_COLORS.orange,
              marginBottom: 16,
            }}
          />

          <div
            style={{
              display: 'flex',
              color: BRAND_COLORS.white,
              fontSize: bodySize,
              fontWeight: 400,
              lineHeight: 1.5,
              opacity: 0.95,
            }}
          >
            {bodyText}
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// BoldGradient — 네이비→블루→골드 그라데이션 + 중앙 대형 텍스트
// ──────────────────────────────────────────────────────
function BoldGradientSatori(props: SatoriTemplateInput): JSX.Element {
  const { headline, body, bgImageUrl, badge, variant, pageIndex, totalPages, ratio } = props;
  const { w, h } = ratio;
  const headlineText = truncateHeadline(headline, 20);
  const bodyText = truncateBody(body, 50);
  const headlineSize = getHeadlineFontSize(headlineText, variant === 'cover' ? 68 : 52);
  const bodySize = getBodyFontSize(bodyText, 22);
  const padding = 48;
  const pageLabel = formatPage(pageIndex, totalPages);

  return (
    <div
      style={{
        width: w,
        height: h,
        display: 'flex',
        position: 'relative',
        background: `linear-gradient(135deg, ${BRAND_COLORS.navy} 0%, ${BRAND_COLORS.blue} 60%, ${BRAND_COLORS.gold} 130%)`,
        fontFamily: 'Pretendard',
      }}
    >
      {/* 배경 이미지는 낮은 opacity로 오버레이 (Satori는 mixBlendMode 미지원 → opacity만) */}
      {bgImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
        <img
          src={bgImageUrl}
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

      {/* 장식 원 — 우상단 */}
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
      {/* 장식 원 — 좌하단 */}
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

      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          display: 'flex',
          flexDirection: 'column',
          padding,
        }}
      >
        {/* 상단 */}
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
              color: BRAND_COLORS.white,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 3,
              opacity: 0.95,
            }}
          >
            YEOSONAM
          </div>
          {pageLabel && (
            <div
              style={{
                display: 'flex',
                color: BRAND_COLORS.gold,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 2,
              }}
            >
              {pageLabel}
            </div>
          )}
        </div>

        {/* 중앙 대형 텍스트 */}
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
          {badge && (
            <div
              style={{
                display: 'flex',
                padding: '6px 18px',
                background: BRAND_COLORS.gold,
                color: BRAND_COLORS.navy,
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: 1.5,
                borderRadius: 999,
                marginBottom: 22,
              }}
            >
              {badge}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              color: BRAND_COLORS.white,
              fontSize: headlineSize,
              fontWeight: 900,
              lineHeight: 1.1,
              letterSpacing: -0.8,
              marginBottom: 22,
              textAlign: 'center',
            }}
          >
            {headlineText}
          </div>

          <div
            style={{
              display: 'flex',
              width: 60,
              height: 2,
              background: BRAND_COLORS.gold,
              marginBottom: 22,
            }}
          />

          <div
            style={{
              display: 'flex',
              color: BRAND_COLORS.white,
              fontSize: bodySize,
              fontWeight: 500,
              lineHeight: 1.55,
              opacity: 0.92,
              textAlign: 'center',
            }}
          >
            {bodyText}
          </div>
        </div>

        {/* 하단 브랜딩 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            color: BRAND_COLORS.white,
            opacity: 0.6,
            fontSize: 10,
            fontWeight: 400,
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
// Magazine — 풀이미지 + 큰 번호(01, 02) + 빨간 배지
// ──────────────────────────────────────────────────────
function MagazineSatori(props: SatoriTemplateInput): JSX.Element {
  const { headline, body, bgImageUrl, badge, pageIndex, totalPages, ratio, variant } = props;
  const { w, h } = ratio;
  const headlineText = truncateHeadline(headline, 20);
  const bodyText = truncateBody(body, 50);
  const headlineSize = getHeadlineFontSize(headlineText, variant === 'cover' ? 54 : 42);
  const bodySize = getBodyFontSize(bodyText, 19);
  const padding = 48;
  const pageNumber = pageIndex ? String(pageIndex).padStart(2, '0') : '01';
  const bigNumberSize = Math.round(w * 0.22);

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
      {/* 풀블리드 배경 이미지 */}
      {bgImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
        <img
          src={bgImageUrl}
          width={w}
          height={h}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: w,
            height: h,
            objectFit: 'cover',
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: w,
            height: h,
            display: 'flex',
            background: BRAND_COLORS.navy,
          }}
        />
      )}

      {/* 어두운 scrim (하단 70% 강조) */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: w,
          height: h,
          display: 'flex',
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.05) 25%, rgba(0,0,0,0.05) 45%, rgba(0,0,0,0.7) 75%, rgba(0,0,0,0.95) 100%)',
        }}
      />

      {/* 큰 번호 — 좌상단에 옅게 */}
      <div
        style={{
          position: 'absolute',
          top: Math.round(padding * 0.4),
          left: padding,
          display: 'flex',
          fontSize: bigNumberSize,
          fontWeight: 900,
          color: BRAND_COLORS.white,
          opacity: 0.18,
          lineHeight: 0.85,
          letterSpacing: -4,
          fontFamily: 'Pretendard',
        }}
      >
        {pageNumber}
      </div>

      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          display: 'flex',
          flexDirection: 'column',
          padding,
        }}
      >
        {/* 상단: 로고 (우측) */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <div
            style={{
              display: 'flex',
              color: BRAND_COLORS.white,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 3,
              opacity: 0.9,
            }}
          >
            YEOSONAM
          </div>
        </div>

        {/* spacer */}
        <div style={{ flex: 1, display: 'flex' }} />

        {/* 하단: 빨간 배지+라인 + 헤드라인 + 본문 */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* 배지 + 빨간 라인 */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: 'flex',
                padding: '4px 12px',
                background: BRAND_COLORS.red,
                color: BRAND_COLORS.white,
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 1.5,
                borderRadius: 2,
              }}
            >
              {badge || `NO. ${pageNumber}`}
            </div>
            <div
              style={{
                flex: 1,
                display: 'flex',
                height: 1,
                background: BRAND_COLORS.red,
                opacity: 0.5,
                marginLeft: 10,
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              color: BRAND_COLORS.white,
              fontSize: headlineSize,
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: -0.5,
              marginBottom: 14,
            }}
          >
            {headlineText}
          </div>

          <div
            style={{
              display: 'flex',
              color: BRAND_COLORS.white,
              fontSize: bodySize,
              fontWeight: 400,
              lineHeight: 1.55,
              opacity: 0.92,
            }}
          >
            {bodyText}
          </div>
        </div>
      </div>
    </div>
  );
}
