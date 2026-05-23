/**
 * POST /api/card-news/render
 * GET  /api/card-news/render?card_news_id=xxx
 *
 * 카드뉴스 슬라이드를 서버에서 ImageResponse(@vercel/og)로 PNG 렌더링한 뒤
 * Supabase Storage에 업로드하고 slide_image_urls를 갱신합니다.
 *
 * Body (POST): { card_news_id: string }
 * Response (POST): { ok: true, slide_image_urls: string[], count: number }
 *
 * GET: { ok: true, rendered: boolean, slide_image_urls?: string[], count?: number }
 *
 * 런타임: edge (@vercel/og 필수)
 */
import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { normalizeSlides } from '@/lib/card-news-types';
import type { CardNewsSlideV2, TextLayer, DesignElement } from '@/lib/card-news-types';
import { notifyCardNewsRenderComplete } from '@/lib/cardnews-render-notify';

export const runtime = 'edge';
export const revalidate = 0;

// ─── 상수 ──────────────────────────────────────────────────

const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1080;
const FONT_NAME = 'Pretendard';
const STORAGE_BUCKET = 'card-news';

// ─── buildSlideJsx ─────────────────────────────────────────
// Slide → ImageResponse가 받을 React JSX로 변환

interface BuildSlideInput {
  slide: CardNewsSlideV2;
  width: number;
  height: number;
}

/**
 * V2 슬라이드를 ImageResponse용 React 요소로 변환합니다.
 * Satori/ImageResponse 제약:
 *   - display: flex 명시 필수
 *   - 인라인 style 객체만 사용 (Tailwind 미지원)
 *   - filter / mixBlendMode 미지원
 *   - position: absolute + top/left/width/height 로 요소 배치
 */
function buildSlideJsx({ slide, width, height }: BuildSlideInput): React.ReactElement {
  const { w, h } = { w: width, h: height };

  // 배경색 (없으면 navy fallback)
  const bgColor = slide.backgroundColor || '#001f3f';
  const bgGradient = slide.backgroundGradient;

  const bgStyle: Record<string, string | number> = bgGradient
    ? { background: bgGradient }
    : { backgroundColor: bgColor };

  return (
    <div
      style={{
        width: w,
        height: h,
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: FONT_NAME,
        ...bgStyle,
      }}
    >
      {/* 배경 이미지 (있을 때) */}
      {slide.image?.url && (
        <img
          src={slide.image.url}
          alt=""
          width={w}
          height={h}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: w,
            height: h,
            objectFit: 'cover',
            objectPosition: `${slide.image.focusX ?? 50}% ${slide.image.focusY ?? 50}%`,
            transform: slide.image.zoom && slide.image.zoom !== 1 ? `scale(${slide.image.zoom})` : undefined,
            opacity: slide.image.brightness ?? 1,
          }}
        />
      )}

      {/* 오버레이 (배경 이미지 위) */}
      {slide.image?.url && slide.overlay && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: w,
            height: h,
            ...buildOverlayStyle(slide.overlay),
          }}
        />
      )}

      {/* 디자인 요소 (텍스트 레이어 아래에 렌더) */}
      {slide.designElements?.map((el) => (
        <div
          key={el.id}
          style={{
            position: 'absolute',
            left: px(el.x, w),
            top: px(el.y, h),
            width: px(el.width, w),
            height: px(el.height, h),
            ...buildDesignElementStyle(el),
          }}
        />
      ))}

      {/* 텍스트 레이어 */}
      {slide.textLayers?.map((layer) => (
        <div
          key={layer.id}
          style={{
            position: 'absolute',
            left: px(layer.x, w),
            top: px(layer.y, h),
            width: px(layer.width, w),
            height: px(layer.height, h),
            display: 'flex',
            alignItems: 'center',
            color: layer.color,
            fontFamily: layer.fontFamily || FONT_NAME,
            fontSize: rem(layer.fontSize),
            fontWeight: layer.fontWeight || 'normal',
            textAlign: layer.textAlign || 'left',
            lineHeight: layer.lineHeight || 1.2,
            letterSpacing: layer.letterSpacing ? `${layer.letterSpacing}px` : undefined,
            opacity: layer.opacity ?? 1,
            textTransform: layer.textTransform || 'none',
            justifyContent: layer.textAlign === 'center' ? 'center' : layer.textAlign === 'right' ? 'flex-end' : 'flex-start',
          }}
        >
          {layer.content}
        </div>
      ))}

      {/* V1 호환 필드 fallback — textLayers가 비어있고 headline/body가 있을 때 */}
      {(!slide.textLayers || slide.textLayers.length === 0) && (slide.headline || slide.body) && (
        <div
          style={{
            position: 'absolute',
            bottom: 80,
            left: 48,
            right: 48,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {slide.headline && (
            <div
              style={{
                display: 'flex',
                color: '#ffffff',
                fontSize: slide.headline && slide.headline.length > 12 ? 36 : 48,
                fontWeight: 700,
                lineHeight: 1.2,
              }}
            >
              {slide.headline}
            </div>
          )}
          {slide.body && (
            <div
              style={{
                display: 'flex',
                color: '#e0e0e0',
                fontSize: slide.body.length > 30 ? 18 : 22,
                fontWeight: 400,
                lineHeight: 1.5,
              }}
            >
              {slide.body}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 헬퍼 ──────────────────────────────────────────────────

/** 퍼센트(0-100)를 px로 변환 */
function px(percent: number, dimension: number): number {
  return Math.round((percent / 100) * dimension);
}

/** rem 단위 문자열 (ImageResponse는 rem 지원) */
function rem(pxSize: number): string {
  return `${pxSize}px`;
}

/** OverlaySettings → 인라인 style */
function buildOverlayStyle(overlay: CardNewsSlideV2['overlay']): Record<string, string | number> {
  const { type, color, opacity, secondaryColor } = overlay;
  const alpha = opacity / 100;

  switch (type) {
    case 'solid':
      return { backgroundColor: color, opacity: alpha };
    case 'gradient-bottom':
      return {
        background: `linear-gradient(180deg, rgba(0,0,0,0) 0%, ${color} 100%)`,
        opacity: alpha * 1.5,
      };
    case 'gradient-top':
      return {
        background: `linear-gradient(0deg, rgba(0,0,0,0) 0%, ${color} 100%)`,
        opacity: alpha * 1.5,
      };
    case 'gradient-center':
      return {
        background: `radial-gradient(ellipse at center, ${color} 0%, rgba(0,0,0,0) 70%)`,
        opacity: alpha,
      };
    case 'gradient-diagonal':
      return {
        background: `linear-gradient(135deg, ${color} 0%, ${secondaryColor || 'rgba(0,0,0,0)'} 100%)`,
        opacity: alpha,
      };
    default:
      return { backgroundColor: color, opacity: alpha };
  }
}

/** DesignElement → 인라인 style */
function buildDesignElementStyle(el: DesignElement): Record<string, string | number> {
  const style: Record<string, string | number> = {};

  if (el.type === 'rectangle' || el.type === 'pill-badge') {
    if (el.backgroundColor) style.backgroundColor = el.backgroundColor;
    if (el.borderColor) style.border = `${el.borderWidth || 1}px solid ${el.borderColor}`;
    if (el.borderRadius) style.borderRadius = el.borderRadius;
    if (el.type === 'pill-badge') style.borderRadius = 999;
  } else if (el.type === 'circle') {
    style.borderRadius = '50%';
    if (el.backgroundColor) style.backgroundColor = el.backgroundColor;
    if (el.borderColor) style.border = `${el.borderWidth || 1}px solid ${el.borderColor}`;
  } else if (el.type === 'line') {
    style.backgroundColor = el.backgroundColor || '#ffffff';
    style.height = el.borderWidth || 2;
  } else if (el.type === 'gradient-box') {
    style.background = el.gradient || (el.backgroundColor ? el.backgroundColor : 'transparent');
    if (el.borderRadius) style.borderRadius = el.borderRadius;
  }

  if (el.opacity !== undefined) style.opacity = el.opacity;
  return style;
}

/**
 * Storage 버킷이 없으면 생성 (public)
 */
async function ensureBucket() {
  try {
    const { data: buckets } = await (supabaseAdmin as any).storage.listBuckets();
    const exists = buckets?.some((b: any) => b.name === STORAGE_BUCKET);
    if (!exists) {
      await (supabaseAdmin as any).storage.createBucket(STORAGE_BUCKET, { public: true });
    }
  } catch {
    // 이미 존재하거나 권한 문제 — 무시
  }
}

// ─── POST ──────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const { card_news_id } = (await request.json()) as { card_news_id?: string };
    if (!card_news_id) {
      return NextResponse.json({ error: 'card_news_id 필수' }, { status: 400 });
    }

    // 1. 카드뉴스 조회
    const { data: cn, error: cnError } = await supabaseAdmin
      .from('card_news')
      .select('*')
      .eq('id', card_news_id)
      .single();

    if (cnError || !cn) {
      return NextResponse.json({ error: '카드뉴스를 찾을 수 없습니다' }, { status: 404 });
    }

    const rawSlides: any[] = Array.isArray(cn.slides) ? cn.slides : [];
    if (rawSlides.length === 0) {
      return NextResponse.json({ ok: true, slide_image_urls: [], count: 0 });
    }

    // 2. V2로 정규화
    const slides = normalizeSlides(rawSlides);

    // 3. Storage 버킷 확인
    await ensureBucket();

    const width = DEFAULT_WIDTH;
    const height = DEFAULT_HEIGHT;
    const uploadedUrls: string[] = [];

    // 4. 각 슬라이드 렌더 + 업로드
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      try {
        const element = buildSlideJsx({ slide, width, height });

        const imageResponse = new ImageResponse(element, {
          width,
          height,
          // @vercel/og에서 폰트는 자동 로드 (system fonts pool 사용)
          // 필요한 경우 emoji: 'twemoji' 등
        });

        const blob = await imageResponse.arrayBuffer();

        // 결정적 path — 재렌더 시 덮어씀 (upsert)
        const path = `${card_news_id}/slide-${i + 1}.png`;

        const { error: uploadError } = await (supabaseAdmin as any).storage
          .from(STORAGE_BUCKET)
          .upload(path, blob, { contentType: 'image/png', upsert: true });

        if (uploadError) {
          console.error(`[card-news/render] slide ${i + 1} upload failed:`, uploadError.message);
          continue;
        }

        const { data: { publicUrl } } = (supabaseAdmin as any).storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(path);

        uploadedUrls.push(publicUrl);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[card-news/render] slide ${i + 1} render failed:`, msg);
        // 실패한 슬라이드는 건너뛰고 나머지 계속
      }
    }

    // 5. DB 업데이트
    if (uploadedUrls.length > 0) {
      const { error: updateError } = await supabaseAdmin
        .from('card_news')
        .update({
          slide_image_urls: uploadedUrls,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', card_news_id);

      if (updateError) {
        console.error('[card-news/render] DB 업데이트 실패:', updateError.message);
      }

      // Notify Slack about successful render (non-blocking)
      notifyCardNewsRenderComplete({
        cardNewsId: card_news_id,
        slideCount: slides.length,
        duration: Date.now() - startTime,
        success: true,
        imageUrls: uploadedUrls,
      }).catch((err) => console.warn('[card-news/render] Slack 알림 실패:', err));
    }

    return NextResponse.json({
      ok: true,
      slide_image_urls: uploadedUrls,
      count: uploadedUrls.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[card-news/render] 전체 렌더 실패:', msg);

    // Notify Slack about failed render (non-blocking)
    notifyCardNewsRenderComplete({
      cardNewsId: card_news_id,
      slideCount: 0,
      duration: Date.now() - startTime,
      success: false,
      imageUrls: [],
    }).catch(() => {});

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ─── GET ───────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const card_news_id = searchParams.get('card_news_id');

  if (!card_news_id) {
    return NextResponse.json({ error: 'card_news_id 쿼리 파라미터 필수' }, { status: 400 });
  }

  try {
    const { data: cn, error: cnError } = await supabaseAdmin
      .from('card_news')
      .select('id, slide_image_urls')
      .eq('id', card_news_id)
      .single();

    if (cnError || !cn) {
      return NextResponse.json({ error: '카드뉴스를 찾을 수 없습니다' }, { status: 404 });
    }

    const urls = cn.slide_image_urls as string[] | null;

    return NextResponse.json({
      ok: true,
      rendered: Array.isArray(urls) && urls.length > 0,
      slide_image_urls: urls ?? [],
      count: urls?.length ?? 0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
