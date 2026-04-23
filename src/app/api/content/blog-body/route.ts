/**
 * POST /api/content/blog-body
 *
 * Body: { product_id?, card_news_id?, brief? }
 * Response: { distribution_id, body }
 *
 * 기존 blog-body.ts 를 content_distributions 연계로 래핑.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { generateContentBrief } from '@/lib/content-pipeline/content-brief';
import { generateBlogBody } from '@/lib/content-pipeline/blog-body';
import type { ContentBrief } from '@/lib/validators/content-brief';

export const runtime = 'nodejs';
export const maxDuration = 90;

interface RequestBody {
  product_id?: string;
  card_news_id?: string;
  brief?: ContentBrief;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const body = (await request.json()) as RequestBody;

    let product: Parameters<typeof generateBlogBody>[0]['productContext'] | undefined = undefined;
    if (body.product_id) {
      const { data: pkg, error } = await supabaseAdmin
        .from('travel_packages')
        .select('title, destination, duration, nights, price, airline, departure_airport, inclusions, itinerary')
        .eq('id', body.product_id)
        .single();
      if (error || !pkg) {
        return NextResponse.json({ error: '상품 조회 실패' }, { status: 404 });
      }
      product = {
        ...(pkg as Record<string, unknown>),
        product_id: body.product_id,
      } as never;
    }

    let brief: ContentBrief;
    if (body.brief) {
      brief = body.brief;
    } else if (product) {
      brief = await generateContentBrief({
        mode: 'product',
        slideCount: 6,
        product: product as never,
      });
    } else {
      return NextResponse.json({ error: 'brief 또는 product_id 필수' }, { status: 400 });
    }

    const blogMarkdown = await generateBlogBody({
      brief,
      productContext: product,
    });

    const payload = {
      markdown: blogMarkdown,
      word_count: blogMarkdown.split(/\s+/).length,
      seo: brief.seo,
    };

    const now = new Date().toISOString();
    const { data: existing } = await supabaseAdmin
      .from('content_distributions')
      .select('id')
      .eq('product_id', body.product_id ?? null)
      .eq('platform', 'blog_body')
      .maybeSingle();

    const row: Record<string, unknown> = {
      product_id: body.product_id ?? null,
      card_news_id: body.card_news_id ?? null,
      platform: 'blog_body',
      payload,
      status: 'draft',
      generation_agent: 'blog-body-v1',
      generation_config: { brief },
      updated_at: now,
    };

    let distribution_id: string;
    if (existing?.id) {
      const { error: upErr } = await supabaseAdmin.from('content_distributions').update(row).eq('id', existing.id);
      if (upErr) throw new Error(`업데이트 실패: ${upErr.message}`);
      distribution_id = existing.id as string;
    } else {
      const { data: ins, error: insErr } = await supabaseAdmin
        .from('content_distributions')
        .insert(row)
        .select('id')
        .single();
      if (insErr || !ins) throw new Error(`INSERT 실패: ${insErr?.message}`);
      distribution_id = ins.id as string;
    }

    return NextResponse.json({ distribution_id, body: payload });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[blog-body] 실패:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
