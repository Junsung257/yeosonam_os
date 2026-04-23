import type { ReactElement } from 'react';
import { NextRequest, NextResponse } from 'next/server';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { buildSatoriElement, isSatoriSupported } from '@/lib/card-news/satori-templates';
import { TemplateId } from '@/lib/card-news/tokens';

export const runtime = 'nodejs'; // Satori/ImageResponse는 edge/node 모두 OK, 명시.
export const maxDuration = 60;

/**
 * POST /api/card-news/render
 *
 * 카드뉴스 슬라이드를 Satori로 서버 렌더 → PNG → Supabase Storage 업로드.
 * 클라이언트 html-to-image 대체 경로.
 *
 * Body: { card_news_id: string }
 *
 * Response: { urls: string[] | null, errors: string[] }
 *
 * 주의:
 *  - `isSatoriSupported`가 false인 슬라이드는 urls[i] = null로 반환 → 클라이언트가 fallback 실행
 *  - 폰트 로드 실패 / 템플릿 렌더 예외 시 해당 슬라이드는 null + errors에 이유 push
 */
export async function POST(request: NextRequest) {
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
      .select('id, slides')
      .eq('id', card_news_id)
      .single();
    if (cnError || !cn) {
      return NextResponse.json({ error: '카드뉴스 조회 실패' }, { status: 404 });
    }

    const slides: any[] = Array.isArray(cn.slides) ? cn.slides : [];
    if (slides.length === 0) {
      return NextResponse.json({ urls: [], errors: ['슬라이드 없음'] });
    }

    // 2. 폰트 1회 로드 (모든 슬라이드 공유)
    let fontRegular: ArrayBuffer | null = null;
    let fontBold: ArrayBuffer | null = null;
    const errors: string[] = [];
    try {
      const regPath = join(process.cwd(), 'public', 'fonts', 'Pretendard-Regular.otf');
      const boldPath = join(process.cwd(), 'public', 'fonts', 'Pretendard-Bold.otf');
      const [reg, bold] = await Promise.all([readFile(regPath), readFile(boldPath)]);
      fontRegular = reg.buffer.slice(reg.byteOffset, reg.byteOffset + reg.byteLength) as ArrayBuffer;
      fontBold = bold.buffer.slice(bold.byteOffset, bold.byteOffset + bold.byteLength) as ArrayBuffer;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[render] 폰트 로드 실패:', msg);
      errors.push(`폰트 로드 실패: ${msg}`);
      // 폰트 없으면 전체 실패 (null 배열 반환 → 클라이언트 html-to-image fallback)
      return NextResponse.json({ urls: slides.map(() => null), errors });
    }

    // 3. Storage 클라이언트 (server-side admin)
    const totalPages = slides.length;
    const urls: (string | null)[] = [];

    // 4. 각 슬라이드 렌더
    for (let i = 0; i < slides.length; i++) {
      const s = slides[i];
      const templateId: string = s.template_id || 'clean_white';

      if (!isSatoriSupported(templateId)) {
        // TEMPLATE_META.satoriReady=false 인 경우만 여기 도달 (현재는 없음)
        console.warn(`[render] slide ${i + 1} template=${templateId} → satoriReady=false, null 반환`);
        errors.push(`slide ${i + 1}: 알 수 없는 템플릿 ${templateId}`);
        urls.push(null);
        continue;
      }

      try {
        const ratio = { w: 1080, h: 1080 };
        const variant: 'cover' | 'content' | 'cta' =
          s.role === 'hook' || i === 0 ? 'cover'
          : s.role === 'cta' || i === slides.length - 1 ? 'cta'
          : 'content';

        const element = buildSatoriElement({
          templateId: templateId as TemplateId,
          headline: s.headline || '',
          body: s.body || '',
          bgImageUrl: s.bg_image_url || undefined,
          badge: s.badge || null,
          variant,
          pageIndex: (s.position ?? i) + (s.position > 0 ? 0 : 1),
          totalPages,
          ratio,
        });

        const svg = await satori(element as ReactElement, {
          width: ratio.w,
          height: ratio.h,
          fonts: [
            { name: 'Pretendard', data: fontRegular!, weight: 400, style: 'normal' },
            { name: 'Pretendard', data: fontBold!, weight: 700, style: 'normal' },
          ],
        });
        const resvg = new Resvg(svg, {
          fitTo: { mode: 'width', value: ratio.w },
          font: { loadSystemFonts: false },
        });
        const pngBuffer = resvg.render().asPng();

        // 결정적 path — 같은 슬라이드 재렌더 시 덮어씌움 (Storage 누적 방지)
        const path = `${card_news_id}/satori-slide-${i + 1}.png`;
        const { error: uploadError } = await supabaseAdmin.storage
          .from('blog-assets')
          .upload(path, pngBuffer, { contentType: 'image/png', upsert: true });
        if (uploadError) throw new Error(`Storage 업로드 실패: ${uploadError.message}`);

        const { data: { publicUrl } } = supabaseAdmin.storage.from('blog-assets').getPublicUrl(path);
        urls.push(publicUrl);
        console.log(`[render] slide ${i + 1} template=${templateId} → Satori OK`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[render] slide ${i + 1} 실패:`, msg);
        errors.push(`slide ${i + 1} (${templateId}): ${msg}`);
        urls.push(null);
      }
    }

    return NextResponse.json({ urls, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[render] 전체 실패:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
