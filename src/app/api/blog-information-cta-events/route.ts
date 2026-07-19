import { NextRequest, NextResponse } from 'next/server';
import { isAllowedBlogInformationEventOrigin } from '@/lib/blog-information-url-policy';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_KEY_RE = /^[0-9a-f-]{36}:(impression|click):[A-Z_]+:(mid|bottom)$/;
const EVENT_TYPES = new Set(['impression', 'click']);
const CTA_KEYS = new Set(['NAVER_CAFE', 'DEAL_ROOM', 'CONSULTATION', 'RELATED_ARTICLES', 'OFFICIAL_SOURCE']);
const PLACEMENTS = new Set(['mid', 'bottom']);

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ ok: true, skipped: true }, { status: 202 });
  if (!isAllowedBlogInformationEventOrigin({
    requestOrigin: request.nextUrl.origin,
    originHeader: request.headers.get('origin'),
    refererHeader: request.headers.get('referer'),
    secFetchSite: request.headers.get('sec-fetch-site'),
  })) {
    return NextResponse.json({ error: 'same-origin CTA event required' }, { status: 403 });
  }
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 2048) return NextResponse.json({ error: 'payload too large' }, { status: 413 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const eventKey = typeof body.event_key === 'string' ? body.event_key : '';
    const creativeId = typeof body.article_id === 'string' ? body.article_id : '';
    const eventType = typeof body.event_type === 'string' ? body.event_type : '';
    const ctaKey = typeof body.cta_key === 'string' ? body.cta_key : '';
    const placement = typeof body.placement === 'string' ? body.placement : '';
    if (!UUID_RE.test(creativeId)
      || !EVENT_KEY_RE.test(eventKey)
      || !UUID_RE.test(eventKey.slice(0, 36))
      || !EVENT_TYPES.has(eventType)
      || !CTA_KEYS.has(ctaKey)
      || !PLACEMENTS.has(placement)
      || eventKey !== `${eventKey.slice(0, 36)}:${eventType}:${ctaKey}:${placement}`) {
      return NextResponse.json({ error: 'invalid CTA event' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc('record_blog_information_cta_event', {
      p_event_key: eventKey,
      p_creative_id: creativeId,
      p_event_type: eventType,
      p_cta_key: ctaKey,
      p_placement: placement,
    });
    if (error) throw error;
    const result = (data as Array<{ accepted?: boolean; deduped?: boolean; rate_limited?: boolean }> | null)?.[0];
    return NextResponse.json({
      ok: true,
      accepted: result?.accepted === true,
      deduped: result?.deduped === true,
      rate_limited: result?.rate_limited === true,
    }, { status: 202 });
  } catch (error) {
    console.warn('[blog-information-cta-events] isolated telemetry failure', error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: true, skipped: true }, { status: 202 });
  }
}
