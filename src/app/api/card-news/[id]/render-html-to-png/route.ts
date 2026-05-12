/**
 * @file src/app/api/card-news/[id]/render-html-to-png/route.ts
 *
 * HTML 모드 카드뉴스의 풀 HTML 을 Puppeteer 로 6장 1080x1080 PNG 로 렌더링.
 * Supabase Storage (blog-assets) 업로드 → card_news_renders 테이블에 upsert →
 * card_news.ig_slide_urls 갱신.
 *
 * Body (선택, 비우면 DB의 html_generated 사용):
 *   { html?: string, scale?: 1 | 2 }
 *
 * Response:
 *   { renders: [{ slide_index, url, error?, storage_path? }, ... 6장] }
 */

import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 180;

interface RequestBody {
  html?: string;
  scale?: 1 | 2;
}

const TEMPLATE_VERSION = 'html-v1';
const FORMAT = '1x1';
const STORAGE_BUCKET = 'blog-assets';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const cardNewsId = params.id;
  const body = ((await request.json().catch(() => ({}))) as RequestBody) || {};
  const scale = body.scale === 1 ? 1 : 2;

  let html = body.html;
  if (!html) {
    const { data, error } = await supabaseAdmin
      .from('card_news')
      .select('html_generated')
      .eq('id', cardNewsId)
      .limit(1);
    if (error) {
      return NextResponse.json({ error: `card_news 조회 실패: ${error.message}` }, { status: 500 });
    }
    html = data?.[0]?.html_generated ?? '';
    if (!html) {
      return NextResponse.json(
        { error: 'html_generated 가 비어있습니다. 먼저 generate-html 로 생성하세요' },
        { status: 400 },
      );
    }
  }

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  const renders: Array<{
    slide_index: number;
    url: string | null;
    storage_path?: string;
    error?: string;
  }> = [];

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--font-render-hinting=none',
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({
      width: 1080,
      height: 1080,
      deviceScaleFactor: scale,
    });

    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 1500));

    const cardCount = await page.$$eval('.card', (els) => els.length);
    if (cardCount === 0) {
      throw new Error('HTML 안에 .card 엘리먼트가 없습니다');
    }

    for (let i = 0; i < cardCount; i++) {
      const slideIndex = i;
      try {
        const cards = await page.$$('.card');
        const card = cards[i];
        const pngBuffer = (await card.screenshot({
          type: 'png',
          captureBeyondViewport: true,
        })) as Buffer;

        const storagePath = `${cardNewsId}/${TEMPLATE_VERSION}-${FORMAT}-slide-${i + 1}.png`;
        const { error: uploadError } = await supabaseAdmin.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, pngBuffer, { contentType: 'image/png', upsert: true });
        if (uploadError) throw new Error(`Storage 업로드 실패: ${uploadError.message}`);

        const {
          data: { publicUrl },
        } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);

        await supabaseAdmin
          .from('card_news_renders')
          .upsert(
            {
              card_news_id: cardNewsId,
              slide_index: slideIndex,
              slide_id: null,
              format: FORMAT,
              template_family: 'html',
              template_version: TEMPLATE_VERSION,
              url: publicUrl,
              storage_path: storagePath,
            },
            { onConflict: 'card_news_id,slide_index,format,template_version' },
          );

        renders.push({ slide_index: slideIndex, url: publicUrl, storage_path: storagePath });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[render-html-to-png] slide ${i + 1} 실패:`, msg);
        renders.push({ slide_index: slideIndex, url: null, error: msg });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Puppeteer 렌더 실패';
    console.error('[render-html-to-png]', msg);
    return NextResponse.json({ error: msg, renders }, { status: 500 });
  } finally {
    if (browser) await browser.close();
  }

  // 성공 슬라이드 URL 모두 모아 card_news.ig_slide_urls 에 저장 (인스타 발행 호환)
  const igSlideUrls = renders
    .sort((a, b) => a.slide_index - b.slide_index)
    .map((r) => r.url)
    .filter((u): u is string => !!u);

  if (igSlideUrls.length === renders.length) {
    await supabaseAdmin
      .from('card_news')
      .update({
        ig_slide_urls: igSlideUrls,
        slide_image_urls: igSlideUrls,
        updated_at: new Date().toISOString(),
      })
      .eq('id', cardNewsId);
  }

  return NextResponse.json({ renders });
}
