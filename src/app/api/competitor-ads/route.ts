/**
 * GET  /api/competitor-ads              — 리스트 조회
 * POST /api/competitor-ads              — 수동 추가 (1건 or 배열)
 *
 * 자동 크롤링은 Meta Ad Library 규약상 복잡.
 * 1단계: 수동 입력 + 분석, 추후 크롤러 붙이기.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ snapshots: [] });
  const brand = request.nextUrl.searchParams.get('brand');
  const destination = request.nextUrl.searchParams.get('destination');
  const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '50');

  let query = supabaseAdmin
    .from('competitor_ad_snapshots')
    .select('*')
    .order('captured_at', { ascending: false })
    .limit(limit);

  if (brand) query = query.eq('brand', brand);
  if (destination) query = query.eq('destination_hint', destination);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ snapshots: data ?? [] });
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const rows = Array.isArray(body) ? body : [body];

    // 기본 검증
    for (const r of rows) {
      if (!r.brand || !r.copy_primary) {
        return NextResponse.json({ error: 'brand, copy_primary 필수' }, { status: 400 });
      }
    }

    const inserts = rows.map((r) => ({
      brand: r.brand,
      platform: r.platform ?? 'meta_ads',
      ad_library_id: r.ad_library_id ?? null,
      source_url: r.source_url ?? null,
      creative_urls: r.creative_urls ?? null,
      copy_primary: r.copy_primary,
      copy_headline: r.copy_headline ?? null,
      copy_description: r.copy_description ?? null,
      cta_button: r.cta_button ?? null,
      landing_url: r.landing_url ?? null,
      product_category: r.product_category ?? null,
      destination_hint: r.destination_hint ?? null,
      promo_type: r.promo_type ?? null,
      impressions_lower: r.impressions_lower ?? null,
      impressions_upper: r.impressions_upper ?? null,
      spend_lower_krw: r.spend_lower_krw ?? null,
      spend_upper_krw: r.spend_upper_krw ?? null,
      active_days: r.active_days ?? null,
      captured_by: r.captured_by ?? 'manual',
    }));

    const { data, error } = await supabaseAdmin
      .from('competitor_ad_snapshots')
      .insert(inserts)
      .select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ inserted: data?.length ?? 0, ids: (data ?? []).map((d: { id: string }) => d.id) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
