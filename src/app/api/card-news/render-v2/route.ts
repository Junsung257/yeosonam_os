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
import React from 'react';
import { NextRequest, NextResponse } from 'next/server';
// Next.js 14 권장: next/og (@vercel/og 를 Next 번들러 친화적으로 래핑)
import { ImageResponse } from 'next/og';
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

    // 2b. 진단 — 3단 시퀀스로 실패 지점 정확히 특정
    const diagnostics: Array<{ step: string; ok: boolean; err?: string; stack?: string }> = [];
    const runDiagnostic = async (
      step: string,
      fn: () => Promise<void>,
    ): Promise<boolean> => {
      try {
        await fn();
        diagnostics.push({ step, ok: true });
        console.log(`[render-v2] 진단 "${step}" 성공`);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? (err.stack ?? '').split('\n').slice(0, 8).join('\n') : '';
        diagnostics.push({ step, ok: false, err: msg, stack });
        console.error(`[render-v2] 진단 "${step}" 실패:`, msg, '\n', stack);
        return false;
      }
    };

    const minimalElement = React.createElement(
      'div',
      {
        style: {
          width: 200, height: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#001f3f', color: '#fff',
          fontSize: 24,
        },
      },
      'TEST',   // text child 직접
    );

    // Step 1: 폰트 없이 기본 렌더 (Satori/ImageResponse 설정 자체 검증)
    const step1Ok = await runDiagnostic('no-font-render', async () => {
      const img = new ImageResponse(minimalElement, { width: 200, height: 200 });
      await img.arrayBuffer();
    });

    // Step 2: ArrayBuffer 폰트로 렌더 (폰트 버퍼 포맷 검증)
    let step2Ok = false;
    if (step1Ok) {
      step2Ok = await runDiagnostic('font-arraybuffer-render', async () => {
        const img = new ImageResponse(minimalElement, {
          width: 200, height: 200,
          fonts: [
            { name: 'Pretendard', data: fontRegular!, weight: 400, style: 'normal' },
          ],
        });
        await img.arrayBuffer();
      });
    }

    // Step 3: Buffer 직접 전달 (대체 포맷 시도 — @vercel/og 는 런타임에 Uint8Array 계열 전부 허용)
    let step3Ok = false;
    if (step1Ok && !step2Ok) {
      step3Ok = await runDiagnostic('font-buffer-render', async () => {
        const regPath = join(process.cwd(), 'public', 'fonts', 'Pretendard-Regular.otf');
        const reg = await readFile(regPath);
        const img = new ImageResponse(minimalElement, {
          width: 200, height: 200,
          // Buffer 를 ArrayBuffer 로 강제 캐스팅 (타입만, 런타임 OK)
          fonts: [
            { name: 'Pretendard', data: reg as unknown as ArrayBuffer, weight: 400, style: 'normal' },
          ],
        });
        await img.arrayBuffer();
      });
    }

    if (!step1Ok || (!step2Ok && !step3Ok)) {
      return NextResponse.json({
        error: '진단 실패 — Satori/폰트 설정 문제',
        diagnostics,
      }, { status: 500 });
    }

    // Step 2 가 실패했지만 Step 3 는 성공 → Buffer 를 메인 렌더에도 쓰도록
    const useBuffer = !step2Ok && step3Ok;
    if (useBuffer) {
      console.log('[render-v2] Buffer 폰트 포맷으로 전환');
      const regPath = join(process.cwd(), 'public', 'fonts', 'Pretendard-Regular.otf');
      const boldPath = join(process.cwd(), 'public', 'fonts', 'Pretendard-Bold.otf');
      const [reg, bold] = await Promise.all([readFile(regPath), readFile(boldPath)]);
      fontRegular = reg as unknown as ArrayBuffer;
      fontBold = bold as unknown as ArrayBuffer;
    }

    // 3. 슬라이드 × 포맷 크로스 렌더
    const results: Array<{
      slide_index: number;
      format: FormatKey;
      url: string | null;
      error?: string;
      stack?: string;
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

        let stage: 'render' | 'retry-render' | 'upload' | 'public-url' | 'db-upsert' = 'render';
        try {
          let pngBuffer: Buffer;
          const effectiveSlide: SlideV2 = slideImageDisabled
            ? ({ ...(slide as SlideV2), bg_image_url: undefined } as SlideV2)
            : (slide as SlideV2);
          try {
            pngBuffer = await renderPng(effectiveSlide);
          } catch (imgErr) {
            const msg = imgErr instanceof Error ? imgErr.message : String(imgErr);
            const errStack = imgErr instanceof Error ? (imgErr.stack ?? '').split('\n').slice(0, 6).join('\n') : '';
            console.warn(
              `[render-v2] slide ${i + 1}/${fk} 1차 렌더 실패 (bg_image_url=${effectiveSlide.bg_image_url ?? '(없음)'}):`,
              msg, '\n', errStack,
            );
            slideImageDisabled = true;
            stage = 'retry-render';
            const retrySlide = { ...effectiveSlide, bg_image_url: undefined };
            pngBuffer = await renderPng(retrySlide);
          }

          // 결정적 path
          stage = 'upload';
          const storagePath = `${body.card_news_id}/v2-${templateVersion}-${fk}-slide-${i + 1}.png`;
          const { error: uploadError } = await supabaseAdmin.storage
            .from('blog-assets')
            .upload(storagePath, pngBuffer, { contentType: 'image/png', upsert: true });
          if (uploadError) throw new Error(`Storage 업로드 실패: ${uploadError.message}`);

          stage = 'public-url';
          const {
            data: { publicUrl },
          } = supabaseAdmin.storage.from('blog-assets').getPublicUrl(storagePath);

          stage = 'db-upsert';
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
          const stack = err instanceof Error ? (err.stack ?? '').split('\n').slice(0, 6).join('\n') : '';
          console.error(`[render-v2] slide ${i + 1}/${fk} 실패 (stage=${stage}):`, msg, '\n', stack);
          results.push({
            slide_index: i,
            format: fk,
            url: null,
            error: `[${stage}] ${msg}`,
            stack,
          });
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
