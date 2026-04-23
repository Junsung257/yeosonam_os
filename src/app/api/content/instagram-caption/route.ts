/**
 * POST /api/content/instagram-caption
 *
 * Body:
 *   { product_id: string, card_news_id?: string, tone?: string }
 * 또는
 *   { brief: ContentBrief, product?: {...}, card_news_id?, product_id?, tone? }
 *
 * 동작:
 *   1. brief 없으면 product_id 로 product 조회 → generateContentBrief 호출
 *   2. generateInstagramCaption 호출
 *   3. content_distributions 에 upsert (platform='instagram_caption')
 *   4. payload 반환
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { generateContentBrief } from '@/lib/content-pipeline/content-brief';
import { generateInstagramCaption } from '@/lib/content-pipeline/agents/instagram-caption';
import type { ContentBrief } from '@/lib/validators/content-brief';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface RequestBody {
  product_id?: string;
  card_news_id?: string;
  brief?: ContentBrief;
  tone?: 'friendly' | 'premium' | 'urgent' | 'informative';
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const body = (await request.json()) as RequestBody;

    // 1. product 조회 (product_id 있으면)
    let product: Parameters<typeof generateInstagramCaption>[0]['product'] | undefined = undefined;
    if (body.product_id) {
      const { data: pkg, error } = await supabaseAdmin
        .from('travel_packages')
        .select('title, destination, duration, nights, price, airline, product_summary, product_highlights')
        .eq('id', body.product_id)
        .single();
      if (error || !pkg) {
        return NextResponse.json({ error: '상품 조회 실패' }, { status: 404 });
      }
      product = pkg as never;
    }

    // 2. brief 확보
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

    // 3. 캡션 생성
    const caption = await generateInstagramCaption({
      brief,
      product,
      tone: body.tone,
    });

    // 4. content_distributions upsert (존재하면 재생성)
    const now = new Date().toISOString();
    const { data: existing } = await supabaseAdmin
      .from('content_distributions')
      .select('id')
      .eq('product_id', body.product_id ?? null)
      .eq('platform', 'instagram_caption')
      .maybeSingle();

    const row: Record<string, unknown> = {
      product_id: body.product_id ?? null,
      card_news_id: body.card_news_id ?? null,
      platform: 'instagram_caption',
      payload: caption,
      status: 'draft',
      generation_agent: 'instagram-caption-v1',
      generation_config: { brief, tone: body.tone ?? null },
      updated_at: now,
    };

    let distribution_id: string;
    if (existing?.id) {
      const { error: upErr } = await supabaseAdmin
        .from('content_distributions')
        .update(row)
        .eq('id', existing.id);
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

    return NextResponse.json({
      distribution_id,
      caption,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[instagram-caption] 실패:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
