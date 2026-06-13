import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

type BlogEventType =
  | 'summary'
  | 'scroll_25'
  | 'scroll_50'
  | 'scroll_75'
  | 'scroll_90'
  | 'cta_impression'
  | 'cta_click';

const BLOG_EVENT_TYPES = new Set<BlogEventType>([
  'summary',
  'scroll_25',
  'scroll_50',
  'scroll_75',
  'scroll_90',
  'cta_impression',
  'cta_click',
]);

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

function normalizeEventType(value: unknown): BlogEventType {
  return typeof value === 'string' && BLOG_EVENT_TYPES.has(value as BlogEventType)
    ? value as BlogEventType
    : 'summary';
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : null;
}

function boundedNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.round(value)))
    : null;
}

function jsonPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
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
      cta_visible,
      cta_placement,
      cta_href,
      event_payload,
      event_type,
      ad_landing_mapping_id,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
    } = body;

    if (!content_creative_id) {
      return NextResponse.json({ error: 'content_creative_id is required' }, { status: 400 });
    }

    const normalizedEventType = normalizeEventType(event_type);
    const isCtaClick = Boolean(cta_clicked) || normalizedEventType === 'cta_click';

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
      time_on_page_seconds: boundedNumber(time_on_page_seconds, 0, 3600),
      max_scroll_depth_pct: boundedNumber(max_scroll_depth_pct, 0, 100),
      cta_clicked: isCtaClick,
      event_type: normalizedEventType,
      cta_visible: Boolean(cta_visible) || normalizedEventType === 'cta_impression' || normalizedEventType === 'cta_click',
      cta_placement: nullableText(cta_placement),
      cta_href: nullableText(cta_href),
      event_payload: jsonPayload(event_payload),
    });

    if (isCtaClick) {
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
    console.error('[blog-engagement] error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'save failed' }, { status: 500 });
  }
}
