import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isBot } from '@/lib/affiliate/bot-filter';
import {
  getClientIp,
  getOrCreateAffiliateSid,
  hashIp,
  hashUserAgent,
} from '@/lib/affiliate/session';
import { getAffiliateRefCookieMaxAgeSec } from '@/lib/affiliate-ref-cookie-policy';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { isValidUuid } from '@/lib/supabase-filter-safe';

type TrackingOutcome = 'accepted' | 'filtered_bot' | 'duplicate';

interface TouchpointResult {
  touchpoint_id: string;
  affiliate_id: string;
  publication_id: string | null;
  link_id: string | null;
  referral_code: string;
  outcome: TrackingOutcome;
}

function getSafeInternalNext(request: NextRequest): string | null {
  const next = request.nextUrl.searchParams.get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null;
  return next;
}

function responseWithNavigation(
  request: NextRequest,
  response: NextResponse,
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  const next = getSafeInternalNext(request);
  const result = next
    ? NextResponse.redirect(new URL(next, request.nextUrl.origin), { status: 302 })
    : NextResponse.json(body, { status });
  for (const cookie of response.cookies.getAll()) result.cookies.set(cookie);
  return result;
}

function refererDomain(request: NextRequest): string | null {
  const referer = request.headers.get('referer');
  if (!referer) return null;
  try {
    return new URL(referer).hostname.toLowerCase().slice(0, 253);
  } catch {
    return null;
  }
}

function trackingErrorCode(message: string): 'invalid_partner' | 'invalid_publication' | 'tracking_failed' {
  if (message.includes('INVALID_PARTNER')) return 'invalid_partner';
  if (message.includes('INVALID_PUBLICATION')) return 'invalid_publication';
  return 'tracking_failed';
}

export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ ok: false, outcome: 'tracking_failed' }, { status: 503 });
  }

  const ref = normalizeAffiliateReferralCode(request.nextUrl.searchParams.get('ref') || '');
  const publicationRaw = request.nextUrl.searchParams.get('publication') || '';
  const publicationId = isValidUuid(publicationRaw) ? publicationRaw : null;
  const packageRaw = request.nextUrl.searchParams.get('pkg') || '';
  const packageId = isValidUuid(packageRaw) ? packageRaw : null;
  const sub = (request.nextUrl.searchParams.get('sub') || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40);

  if (!publicationId && !ref) {
    return NextResponse.json({ ok: false, outcome: 'invalid_partner' }, { status: 400 });
  }

  const cookieCarrier = NextResponse.next();
  const { sid } = getOrCreateAffiliateSid(request, cookieCarrier);
  const marketingConsent = request.cookies.get('ys_marketing_consent')?.value === 'true';
  const consentState = marketingConsent ? 'MARKETING_CONSENT' : 'SESSION_ONLY';
  const eventIdRaw = request.nextUrl.searchParams.get('event') || '';
  const eventId = isValidUuid(eventIdRaw) ? eventIdRaw : crypto.randomUUID();

  try {
    const { data, error } = await supabaseAdmin.rpc('record_affiliate_touchpoint_v2', {
      p_event_id: eventId,
      p_session_id: sid,
      p_referral_code: ref || null,
      p_publication_id: publicationId,
      p_package_id: packageId,
      p_sub_id: sub || null,
      p_ip_hash: hashIp(getClientIp(request)),
      p_user_agent_hash: hashUserAgent(request.headers.get('user-agent')),
      p_is_bot: isBot(request.headers.get('user-agent')),
      p_consent_state: consentState,
      p_landing_url: getSafeInternalNext(request),
      p_referer_domain: refererDomain(request),
    });

    if (error) throw error;
    const result = (Array.isArray(data) ? data[0] : data) as TouchpointResult | null;
    if (!result?.touchpoint_id || !result.affiliate_id) {
      throw new Error('TRACKING_RESULT_MISSING');
    }

    const maxAge = getAffiliateRefCookieMaxAgeSec(request);
    const attributionCookie = {
      path: '/',
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      ...(maxAge !== undefined ? { maxAge } : {}),
    };
    cookieCarrier.cookies.set('aff_ref', result.referral_code, { ...attributionCookie, httpOnly: false });
    cookieCarrier.cookies.set('aff_touchpoint', result.touchpoint_id, attributionCookie);
    if (result.publication_id) {
      cookieCarrier.cookies.set('aff_publication', result.publication_id, attributionCookie);
    } else {
      cookieCarrier.cookies.set('aff_publication', '', { ...attributionCookie, maxAge: 0 });
    }
    if (sub) {
      cookieCarrier.cookies.set('aff_sub', sub, { ...attributionCookie, httpOnly: false });
    } else {
      cookieCarrier.cookies.set('aff_sub', '', { ...attributionCookie, httpOnly: false, maxAge: 0 });
    }

    return responseWithNavigation(request, cookieCarrier, {
      ok: true,
      outcome: result.outcome,
      event_id: eventId,
      affiliate_id: result.affiliate_id,
      publication_id: result.publication_id,
      touchpoint_id: result.touchpoint_id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const outcome = trackingErrorCode(message);
    console.error('[Affiliate tracking]', { outcome, eventId, publicationId, packageId });
    cookieCarrier.cookies.set('aff_ref', '', { path: '/', maxAge: 0 });
    cookieCarrier.cookies.set('aff_sub', '', { path: '/', maxAge: 0 });
    cookieCarrier.cookies.set('aff_publication', '', { path: '/', maxAge: 0 });
    cookieCarrier.cookies.set('aff_touchpoint', '', { path: '/', maxAge: 0 });
    return responseWithNavigation(
      request,
      cookieCarrier,
      { ok: false, outcome, event_id: eventId },
      outcome === 'tracking_failed' ? 503 : 422,
    );
  }
}
