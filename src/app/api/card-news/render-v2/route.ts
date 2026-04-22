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

    for (let i = 0; i < slides.length; i++) {
      const slide = { ...slides[i] };
      if (familyOverride) slide.template_family = familyOverride;
      if (!slide.template_family) slide.template_family = 'editorial';

      for (const fk of formats) {
        const format = FORMATS[fk];
        if (!format) {
          results.push({ slide_index: i, format: fk, url: null, error: `알 수 없는 format: ${fk}` });
          continue;
        }

        try {
          const element = renderSlideV2({
            slide: slide as SlideV2,
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
          const pngBuffer = Buffer.from(await image.arrayBuffer());

          const storagePath = `${body.card_news_id}/v2-${fk}-slide-${i + 1}-${Date.now()}.png`;
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

    return NextResponse.json({ renders: results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[render-v2] 전체 실패:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
