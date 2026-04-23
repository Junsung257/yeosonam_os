/**
 * POST /api/content/cover-critic
 *
 * Body: { card_news_id } — 해당 카드뉴스의 첫 슬라이드 (cover) 비평
 * Response: { critique: CoverCritique }
 *
 * Claude Sonnet 4.6 사용 (Gemini Flash 보다 discerning).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { critiqueCover } from '@/lib/content-pipeline/agents/cover-critic';
import type { SlideV2 } from '@/lib/card-news/v2/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface RequestBody {
  card_news_id: string;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = (await request.json()) as RequestBody;
    if (!body.card_news_id) {
      return NextResponse.json({ error: 'card_news_id 필수' }, { status: 400 });
    }

    const { data: cn, error } = await supabaseAdmin
      .from('card_news')
      .select('slides, generation_config, package_id')
      .eq('id', body.card_news_id)
      .single();
    if (error || !cn) return NextResponse.json({ error: '카드뉴스 조회 실패' }, { status: 404 });

    const slides = Array.isArray(cn.slides) ? (cn.slides as SlideV2[]) : [];
    if (slides.length === 0) return NextResponse.json({ error: '슬라이드 없음' }, { status: 400 });

    const cover = slides[0];

    // product 맥락
    let productContext: Parameters<typeof critiqueCover>[0]['product_context'] = undefined;
    if (cn.package_id) {
      const { data: pkg } = await supabaseAdmin
        .from('travel_packages')
        .select('title, destination, price, product_highlights')
        .eq('id', cn.package_id)
        .single();
      if (pkg) {
        const p = pkg as Record<string, unknown>;
        productContext = {
          title: p.title as string,
          destination: p.destination as string | undefined,
          price: p.price as number | undefined,
          key_selling_points: p.product_highlights as string[] | undefined,
        };
      }
    }

    // brief.target_audience 가 generation_config 에 있을 수 있음
    const brief = (cn.generation_config as { brief?: { target_audience?: string } } | null)?.brief;
    if (brief?.target_audience && productContext) {
      productContext.target_audience = brief.target_audience;
    }

    const critique = await critiqueCover({ cover, product_context: productContext });

    return NextResponse.json({ critique });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cover-critic] 실패:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
