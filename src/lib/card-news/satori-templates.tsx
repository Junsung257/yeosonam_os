/**
 * Satori-safe 카드뉴스 템플릿
 *
 * 제약:
 *  - Tailwind 미지원 → 인라인 style 객체만 사용
 *  - flex 컨테이너는 `display: 'flex'` 명시 (Satori는 기본값 없음)
 *  - 여러 자식이 있는 div는 반드시 flex
 *  - box-shadow, filter, transform 대부분 미지원
 *  - 이미지는 원격 URL (fetch 후 base64 권장) 또는 data URL만 가능
 *
 * 1순위 마이그레이션: CleanWhite, LuxuryGold (TEMPLATE_META.satoriReady=true)
 */
import { BRAND_COLORS, getHeadlineFontSize, getBodyFontSize, truncateHeadline, truncateBody, TemplateId } from './tokens';

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

/** 이 템플릿을 Satori로 렌더 가능한가? */
export function isSatoriSupported(templateId: string | undefined): boolean {
  return templateId === 'clean_white' || templateId === 'luxury_gold';
}

/** Satori 템플릿 라우팅 */
export function buildSatoriElement(input: SatoriTemplateInput): JSX.Element {
  switch (input.templateId) {
    case 'clean_white':
      return <CleanWhiteSatori {...input} />;
    case 'luxury_gold':
      return <LuxuryGoldSatori {...input} />;
    default:
      return <CleanWhiteSatori {...input} />;
  }
}

// ──────────────────────────────────────────────────────
// CleanWhite — 상단 이미지 + 하단 흰 카드
// ──────────────────────────────────────────────────────
function CleanWhiteSatori(props: SatoriTemplateInput): JSX.Element {
  const { headline, body, bgImageUrl, badge, variant, pageIndex, totalPages, ratio } = props;
  const w = ratio.w;
  const h = ratio.h;
  const headlineText = truncateHeadline(headline, 20);
  const bodyText = truncateBody(body, 50);
  const headlineSize = getHeadlineFontSize(headlineText, variant === 'cover' ? 56 : 44);
  const bodySize = getBodyFontSize(bodyText, 22);
  const imageH = Math.round(h * 0.58);
  const cardH = h - imageH;

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
          background: bgImageUrl ? 'transparent' : BRAND_COLORS.softBg,
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
            textShadow: '0 1px 3px rgba(0,0,0,0.4)',
          }}
        >
          YEOSONAM
        </div>
        {/* 페이지 번호 — 우상단 */}
        {pageIndex && totalPages && (
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
              textShadow: '0 1px 3px rgba(0,0,0,0.4)',
            }}
          >
            {String(pageIndex).padStart(2, '0')} / {String(totalPages).padStart(2, '0')}
          </div>
        )}
      </div>

      {/* 하단 카드 영역 */}
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
              background: BRAND_COLORS.blue,
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
// LuxuryGold — 블랙 배경 + 골드 보더 + 중앙 정렬
// ──────────────────────────────────────────────────────
function LuxuryGoldSatori(props: SatoriTemplateInput): JSX.Element {
  const { headline, body, bgImageUrl, badge, variant, pageIndex, totalPages, ratio } = props;
  const w = ratio.w;
  const h = ratio.h;
  const headlineText = truncateHeadline(headline, 20);
  const bodyText = truncateBody(body, 50);
  const headlineSize = getHeadlineFontSize(headlineText, variant === 'cover' ? 52 : 42);
  const bodySize = getBodyFontSize(bodyText, 20);
  const borderInset = 22;

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
      {/* 배경 이미지 (어두운 톤) */}
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

      {/* 골드 보더 (외곽선) */}
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

      {/* 컨텐츠 */}
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
          {pageIndex && totalPages && (
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
              {String(pageIndex).padStart(2, '0')} / {String(totalPages).padStart(2, '0')}
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

          {/* 상단 장식선 */}
          <div
            style={{
              display: 'flex',
              width: 40,
              height: 1,
              background: BRAND_COLORS.gold,
              marginBottom: 22,
            }}
          />

          {/* 헤드라인 (세리프 이탤릭 → Satori는 이탤릭 제한적이므로 일반) */}
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

          {/* 본문 */}
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

          {/* 하단 장식선 */}
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

        {/* 하단 브랜딩 */}
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
