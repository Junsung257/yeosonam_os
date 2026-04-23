/**
 * POST /api/card-news/render-v2
 *
 * 카드뉴스 V2 렌더: brief(또는 slides V2 배열)를 받아 1~4개 포맷으로
 * Satori 렌더 → Supabase Storage 업로드 → card_news_renders 테이블에 기록.
 *
 * Body:
 *   {
 *     card_news_id: string,              // 기존 카드뉴스 레코드 (slides 컬럼에서 V2 slides 꺼냄)
 *     formats?: Array<'1x1'|'4x5'|'9x16'|'blog'>,  // 기본 ['1x1']
 *     family?: 'editorial'|'cinematic'|'premium'|'bold',  // slide.template_family 오버라이드
 *   }
 *
 * Response:
 *   {
 *     renders: Array<{
 *       slide_index: number, format: string, url: string | null, error?: string
 *     }>
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { ImageResponse } from '@vercel/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { renderSlideV2, FORMATS } from '@/lib/card-news/v2/render-v2';
import type { FormatKey, SlideV2 } from '@/lib/card-news/v2/types';
import type { TemplateFamily } from '@/lib/validators/content-brief';

export const runtime = 'nodejs';
export const maxDuration = 90;

interface RequestBody {
  card_news_id: string;
  formats?: FormatKey[];
  family?: TemplateFamily;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const body = (await request.json()) as RequestBody;
    if (!body.card_news_id) {
      return NextResponse.json({ error: 'card_news_id 필수' }, { status: 400 });
    }

    const formats: FormatKey[] = (body.formats && body.formats.length > 0)
      ? body.formats
      : ['1x1'];

    // 1. 카드뉴스 조회
    const { data: cn, error: cnError } = await supabaseAdmin
      .from('card_news')
      .select('id, slides, template_family, template_version')
      .eq('id', body.card_news_id)
      .single();
    if (cnError || !cn) {
      return NextResponse.json({ error: '카드뉴스 조회 실패' }, { status: 404 });
    }

    const slides: SlideV2[] = Array.isArray(cn.slides) ? (cn.slides as SlideV2[]) : [];
    if (slides.length === 0) {
      return NextResponse.json({ renders: [], error: '슬라이드 없음' });
    }

    // 카드뉴스 레코드의 family 혹은 요청의 family, 기본값 editorial
    const familyOverride: TemplateFamily | undefined =
      body.family ?? (cn.template_family as TemplateFamily | undefined) ?? undefined;
    const templateVersion = (cn.template_version as string | undefined) ?? 'v2';

    // 2. 폰트 로드 (모든 슬라이드 공유)
    let fontRegular: ArrayBuffer | null = null;
    let fontBold: ArrayBuffer | null = null;
    try {
      const regPath = join(process.cwd(), 'public', 'fonts', 'Pretendard-Regular.otf');
      const boldPath = join(process.cwd(), 'public', 'fonts', 'Pretendard-Bold.otf');
      const [reg, bold] = await Promise.all([readFile(regPath), readFile(boldPath)]);
      fontRegular = reg.buffer.slice(reg.byteOffset, reg.byteOffset + reg.byteLength) as ArrayBuffer;
      fontBold = bold.buffer.slice(bold.byteOffset, bold.byteOffset + bold.byteLength) as ArrayBuffer;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `폰트 로드 실패: ${msg}` }, { status: 500 });
    }

    // 3. 슬라이드 × 포맷 크로스 렌더
    const results: Array<{
      slide_index: number;
      format: FormatKey;
      url: string | null;
      error?: string;
    }> = [];

    const totalPages = slides.length;

    // URL 검증 헬퍼 — Satori/fetch 가 파싱할 수 있는 https URL 만 통과
    const isValidImageUrl = (url: unknown): url is string => {
      if (typeof url !== 'string' || url.length === 0) return false;
      try {
        const u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        return false;
      }
    };

    for (let i = 0; i < slides.length; i++) {
      const slide = { ...slides[i] };
      if (familyOverride) slide.template_family = familyOverride;
      if (!slide.template_family) slide.template_family = 'editorial';
      // 깨진 URL 사전 차단 — 빈 문자열/상대경로/data: 등 모두 제거
      if (!isValidImageUrl(slide.bg_image_url)) {
        if (slide.bg_image_url) {
          console.warn(`[render-v2] slide ${i + 1} bg_image_url 무효 → 제거:`, slide.bg_image_url);
        }
        slide.bg_image_url = undefined;
      }
      // 슬라이드 레벨에서 이미지 실패 한번 만나면 다음 format 에도 이미지 제외 — 성능 최적화
      let slideImageDisabled = false;

      for (const fk of formats) {
        const format = FORMATS[fk];
        if (!format) {
          results.push({ slide_index: i, format: fk, url: null, error: `알 수 없는 format: ${fk}` });
          continue;
        }

        const renderPng = async (slideForRender: SlideV2): Promise<Buffer> => {
          const element = renderSlideV2({
            slide: slideForRender,
            format,
            pageIndex: i + 1,
            totalPages,
          });
          const image = new ImageResponse(element, {
            width: format.w,
            height: format.h,
            fonts: [
              { name: 'Pretendard', data: fontRegular!, weight: 400, style: 'normal' },
              { name: 'Pretendard', data: fontBold!, weight: 700, style: 'normal' },
            ],
          });
          return Buffer.from(await image.arrayBuffer());
        };

        try {
          let pngBuffer: Buffer;
          const effectiveSlide: SlideV2 = slideImageDisabled
            ? ({ ...(slide as SlideV2), bg_image_url: undefined } as SlideV2)
            : (slide as SlideV2);
          try {
            pngBuffer = await renderPng(effectiveSlide);
          } catch (imgErr) {
            const msg = imgErr instanceof Error ? imgErr.message : String(imgErr);
            if (effectiveSlide.bg_image_url) {
              console.warn(
                `[render-v2] slide ${i + 1} 이미지 렌더 실패 → 슬라이드 레벨에서 이미지 비활성화, 재시도:`,
                msg,
                'url=', effectiveSlide.bg_image_url,
              );
              slideImageDisabled = true;   // 다음 포맷 루프에서도 이미지 없이
              const retrySlide = { ...effectiveSlide, bg_image_url: undefined };
              pngBuffer = await renderPng(retrySlide);
            } else {
              throw imgErr;
            }
          }

          // 결정적 path — 같은 (card_news_id, format, slide_index, template_version)
          // 은 항상 같은 파일명으로 덮어씀. Storage 무한 누적 방지.
          const storagePath = `${body.card_news_id}/v2-${templateVersion}-${fk}-slide-${i + 1}.png`;
          const { error: uploadError } = await supabaseAdmin.storage
            .from('blog-assets')
            .upload(storagePath, pngBuffer, { contentType: 'image/png', upsert: true });
          if (uploadError) throw new Error(`Storage 업로드 실패: ${uploadError.message}`);

          const {
            data: { publicUrl },
          } = supabaseAdmin.storage.from('blog-assets').getPublicUrl(storagePath);

          // card_news_renders 테이블에 업서트
          await supabaseAdmin
            .from('card_news_renders')
            .upsert({
              card_news_id: body.card_news_id,
              slide_index: i,
              slide_id: slide.id ?? null,
              format: fk,
              template_family: slide.template_family,
              template_version: templateVersion,
              url: publicUrl,
              storage_path: storagePath,
            }, { onConflict: 'card_news_id,slide_index,format,template_version' });

          results.push({ slide_index: i, format: fk, url: publicUrl });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[render-v2] slide ${i + 1} format ${fk} 실패:`, msg);
          results.push({ slide_index: i, format: fk, url: null, error: msg });
        }
      }
    }

    // 가능한 경우 slides 배열/카드 레코드 둘 다 template_family 동기화
    if (familyOverride) {
      try {
        const updatedSlides = slides.map((s) => ({ ...s, template_family: familyOverride }));
        await supabaseAdmin
          .from('card_news')
          .update({
            template_family: familyOverride,
            template_version: templateVersion,
            slides: updatedSlides,
          })
          .eq('id', body.card_news_id);
      } catch (err) {
        console.warn('[render-v2] family 동기화 실패 (렌더 결과는 OK):', err instanceof Error ? err.message : err);
      }
    }

    return NextResponse.json({ renders: results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[render-v2] 전체 실패:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
