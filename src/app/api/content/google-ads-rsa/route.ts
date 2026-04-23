import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { generateContentBrief } from '@/lib/content-pipeline/content-brief';
import { generateGoogleAdsRSA } from '@/lib/content-pipeline/agents/google-ads-rsa';
import type { ContentBrief } from '@/lib/validators/content-brief';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface RequestBody {
  product_id?: string;
  card_news_id?: string;
  brief?: ContentBrief;
  target_keywords?: string[];
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = (await request.json()) as RequestBody;

    let product: Parameters<typeof generateGoogleAdsRSA>[0]['product'] | undefined = undefined;
    if (body.product_id) {
      const { data: pkg } = await supabaseAdmin
        .from('travel_packages')
        .select('title, destination, duration, nights, price, airline, departure_airport, product_summary, product_highlights')
        .eq('id', body.product_id)
        .single();
      if (!pkg) return NextResponse.json({ error: '상품 조회 실패' }, { status: 404 });
      product = pkg as never;
    }

    let brief: ContentBrief;
    if (body.brief) brief = body.brief;
    else if (product) brief = await generateContentBrief({ mode: 'product', slideCount: 6, product: product as never });
    else return NextResponse.json({ error: 'brief 또는 product_id 필수' }, { status: 400 });

    const rsa = await generateGoogleAdsRSA({ brief, product, target_keywords: body.target_keywords });

    const now = new Date().toISOString();
    const { data: existing } = await supabaseAdmin
      .from('content_distributions')
      .select('id')
      .eq('product_id', body.product_id ?? null)
      .eq('platform', 'google_ads_rsa')
      .maybeSingle();

    const row = {
      product_id: body.product_id ?? null,
      card_news_id: body.card_news_id ?? null,
      platform: 'google_ads_rsa',
      payload: rsa,
      status: 'draft',
      generation_agent: 'google-ads-rsa-v1',
      generation_config: { brief, target_keywords: body.target_keywords ?? null },
      updated_at: now,
    };

    let distribution_id: string;
    if (existing?.id) {
      await supabaseAdmin.from('content_distributions').update(row).eq('id', existing.id);
      distribution_id = existing.id as string;
    } else {
      const { data: ins, error } = await supabaseAdmin.from('content_distributions').insert(row).select('id').single();
      if (error || !ins) throw new Error(error?.message ?? 'INSERT 실패');
      distribution_id = ins.id as string;
    }

    return NextResponse.json({ distribution_id, rsa });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[google-ads-rsa] 실패:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
