import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

async function resolveAdLandingMappingId(input: {
  explicitId?: string | null;
  contentCreativeId: string;
  utmSource?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
}): Promise<string | null> {
  if (input.explicitId) return input.explicitId;
  if (!input.utmCampaign) return null;

  let query = supabaseAdmin
    .from('ad_landing_mappings')
    .select('id')
    .eq('content_creative_id', input.contentCreativeId)
    .eq('utm_campaign', input.utmCampaign)
    .limit(1);
  if (input.utmSource) query = query.eq('utm_source', input.utmSource);
  if (input.utmTerm) query = query.eq('utm_term', input.utmTerm);
  const { data } = await query;
  return data?.[0]?.id ?? null;
}

async function incrementCtaClicks(mappingId: string | null) {
  if (!mappingId) return;
  const { data } = await supabaseAdmin
    .from('ad_landing_mappings')
    .select('cta_clicks')
    .eq('id', mappingId)
    .maybeSingle();
  await supabaseAdmin
    .from('ad_landing_mappings')
    .update({
      cta_clicks: Number((data as { cta_clicks?: number } | null)?.cta_clicks || 0) + 1,
      last_cta_click_at: new Date().toISOString(),
    })
    .eq('id', mappingId);
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ ok: true, skipped: true });

  try {
    const body = await request.json();
    const {
      content_creative_id,
      session_id,
      user_id,
      time_on_page_seconds,
      max_scroll_depth_pct,
      cta_clicked,
      ad_landing_mapping_id,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
    } = body;

    if (!content_creative_id) {
      return NextResponse.json({ error: 'content_creative_id 필수' }, { status: 400 });
    }

    const resolvedMappingId = await resolveAdLandingMappingId({
      explicitId: ad_landing_mapping_id ?? null,
      contentCreativeId: content_creative_id,
      utmSource: utm_source ?? null,
      utmCampaign: utm_campaign ?? null,
      utmTerm: utm_term ?? null,
    });

    await supabaseAdmin.from('blog_engagement_logs').insert({
      content_creative_id,
      ad_landing_mapping_id: resolvedMappingId,
      session_id: session_id || null,
      user_id: user_id || null,
      utm_source: utm_source || null,
      utm_medium: utm_medium || null,
      utm_campaign: utm_campaign || null,
      utm_term: utm_term || null,
      time_on_page_seconds: typeof time_on_page_seconds === 'number' ? Math.max(0, Math.min(3600, time_on_page_seconds)) : null,
      max_scroll_depth_pct: typeof max_scroll_depth_pct === 'number' ? Math.max(0, Math.min(100, Math.round(max_scroll_depth_pct))) : null,
      cta_clicked: !!cta_clicked,
    });

    if (cta_clicked) {
      await supabaseAdmin.from('content_attribution_events').insert({
        content_id: content_creative_id,
        content_type: 'blog',
        ad_landing_mapping_id: resolvedMappingId,
        session_id: session_id || null,
        utm_source: utm_source || null,
        utm_medium: utm_medium || null,
        utm_campaign: utm_campaign || null,
        event_type: 'click',
      });
      await incrementCtaClicks(resolvedMappingId);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[blog-engagement] 오류:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : '저장 실패' }, { status: 500 });
  }
}
