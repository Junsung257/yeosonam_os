/**
 * POST /api/content/threads-post
 *
 * Body: { product_id?, card_news_id?, brief?, style? }
 * Response: { distribution_id, post }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { generateContentBrief } from '@/lib/content-pipeline/content-brief';
import { generateThreadsPost } from '@/lib/content-pipeline/agents/threads-post';
import type { ContentBrief } from '@/lib/validators/content-brief';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface RequestBody {
  product_id?: string;
  card_news_id?: string;
  brief?: ContentBrief;
  style?: 'personal_story' | 'info_list' | 'question' | 'behind_the_scene';
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const body = (await request.json()) as RequestBody;

    let product: Parameters<typeof generateThreadsPost>[0]['product'] | undefined = undefined;
    if (body.product_id) {
      const { data: pkg, error } = await supabaseAdmin
        .from('travel_packages')
        .select('title, destination, duration, nights, price, product_summary, product_highlights')
        .eq('id', body.product_id)
        .single();
      if (error || !pkg) {
        return NextResponse.json({ error: '상품 조회 실패' }, { status: 404 });
      }
      product = pkg as never;
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

    const post = await generateThreadsPost({
      brief,
      product,
      style: body.style,
    });

    const now = new Date().toISOString();
    const { data: existing } = await supabaseAdmin
      .from('content_distributions')
      .select('id')
      .eq('product_id', body.product_id ?? null)
      .eq('platform', 'threads_post')
      .maybeSingle();

    const row: Record<string, unknown> = {
      product_id: body.product_id ?? null,
      card_news_id: body.card_news_id ?? null,
      platform: 'threads_post',
      payload: post,
      status: 'draft',
      generation_agent: 'threads-post-v1',
      generation_config: { brief, style: body.style ?? null },
      updated_at: now,
    };

    let distribution_id: string;
    if (existing?.id) {
      const { error: upErr } = await supabaseAdmin.from('content_distributions').update(row).eq('id', existing.id);
      if (upErr) throw new Error(`업데이트 실패: ${upErr.message}`);
      distribution_id = existing.id as string;
    } else {
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('content_distributions')
        .insert(row)
        .select('id')
        .single();
      if (insErr || !inserted) throw new Error(`INSERT 실패: ${insErr?.message}`);
      distribution_id = inserted.id as string;
    }

    return NextResponse.json({ distribution_id, post });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[threads-post] 실패:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
