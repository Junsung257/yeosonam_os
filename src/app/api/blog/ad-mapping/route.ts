import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { buildUtm, applyUtmToUrl } from '@/lib/utm-builder';

/**
 * 블로그 ↔ 광고 캠페인 매핑 관리
 *
 * GET  /api/blog/ad-mapping?content_creative_id=xxx    → 해당 블로그의 매핑 목록
 * GET  /api/blog/ad-mapping                            → 전체 목록 (필터)
 * POST /api/blog/ad-mapping                            → 매핑 신규 + UTM URL 자동 생성
 * PATCH /api/blog/ad-mapping                           → 활성/비활성, DKI 헤드라인 수정
 * DELETE /api/blog/ad-mapping?id=xxx
 */

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ items: [] });

  const { searchParams } = request.nextUrl;
  const creativeId = searchParams.get('content_creative_id');
  const platform = searchParams.get('platform');
  const active = searchParams.get('active');

  try {
    let q = supabaseAdmin
      .from('ad_landing_mappings')
      .select('*, content_creatives(slug, seo_title, destination, landing_enabled), ad_campaigns(name, status)')
      .order('created_at', { ascending: false })
      .limit(200);

    if (creativeId) q = q.eq('content_creative_id', creativeId);
    if (platform) q = q.eq('platform', platform);
    if (active === 'true') q = q.eq('active', true);
    else if (active === 'false') q = q.eq('active', false);

    const { data, error } = await q;
    if (error) throw error;

    return NextResponse.json({ items: data || [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const {
      content_creative_id, campaign_id, platform, keyword,
      match_type, dki_headline, dki_subtitle, creative_variant, campaign_slug,
    } = body;

    if (!content_creative_id || !platform || !keyword) {
      return NextResponse.json({ error: 'content_creative_id, platform, keyword 필수' }, { status: 400 });
    }

    // 블로그 slug 조회
    const { data: blog } = await supabaseAdmin
      .from('content_creatives')
      .select('slug')
      .eq('id', content_creative_id)
      .limit(1);

    const slug = blog?.[0]?.slug;
    if (!slug) return NextResponse.json({ error: '블로그 slug 없음' }, { status: 404 });

    // UTM 생성 + 정규화
    const utm = buildUtm({
      base_url: `${BASE_URL}/blog/${slug}`,
      platform,
      campaign_slug: campaign_slug || `${platform}_${keyword}`,
      keyword,
      creative_variant,
    });
    const landingUrl = applyUtmToUrl(`${BASE_URL}/blog/${slug}`, utm);

    const { data, error } = await supabaseAdmin
      .from('ad_landing_mappings')
      .insert({
        content_creative_id,
        campaign_id: campaign_id ?? null,
        platform,
        keyword,
        match_type: match_type || 'exact',
        utm_source: utm.utm_source,
        utm_medium: utm.utm_medium,
        utm_campaign: utm.utm_campaign,
        utm_content: utm.utm_content,
        utm_term: utm.utm_term,
        dki_headline: dki_headline ?? null,
        dki_subtitle: dki_subtitle ?? null,
        landing_url: landingUrl,
        active: true,
      })
      .select();

    if (error) throw error;
    return NextResponse.json({ item: data?.[0] }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '생성 실패' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const { id, active, dki_headline, dki_subtitle, keyword, match_type } = body;
    if (!id) return NextResponse.json({ error: 'id 필수' }, { status: 400 });

    const update: Record<string, unknown> = {};
    if (active !== undefined) update.active = active;
    if (dki_headline !== undefined) update.dki_headline = dki_headline;
    if (dki_subtitle !== undefined) update.dki_subtitle = dki_subtitle;
    if (keyword !== undefined) update.keyword = keyword;
    if (match_type !== undefined) update.match_type = match_type;

    const { data, error } = await supabaseAdmin
      .from('ad_landing_mappings')
      .update(update)
      .eq('id', id)
      .select();

    if (error) throw error;
    return NextResponse.json({ item: data?.[0] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '수정 실패' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id 필수' }, { status: 400 });

  try {
    const { error } = await supabaseAdmin.from('ad_landing_mappings').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '삭제 실패' }, { status: 500 });
  }
}
