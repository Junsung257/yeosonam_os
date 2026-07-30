import { NextRequest } from 'next/server';
import { successResponse, ApiErrors } from '@/lib/api-response';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { createLandingBookingRequest, findExistingLandingBookingReplay } from '@/lib/lead-booking-request';
import { rateLimit } from '@/lib/rate-limiter';
import {
  normalizeServerAttribution,
  recordServerAnalyticsEvent,
} from '@/lib/analytics/server-events';

const PLACEHOLDER_NAMES = new Set([
  '-',
  'n/a',
  'na',
  'unknown',
  'test',
  '고객',
  '고객님',
  '문의',
  '미입력',
  '없음',
  '익명',
  '카카오문의',
  '테스트',
]);
const TRACKING_VALUE_RE = /^[\p{L}\p{N} _./:+-]{1,200}$/u;
const TRACKING_EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const TRACKING_PHONE_RE = /(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/;

function safeTrackingValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    !TRACKING_VALUE_RE.test(normalized)
    || TRACKING_EMAIL_RE.test(normalized)
    || TRACKING_PHONE_RE.test(normalized)
  ) return null;
  return normalized;
}

function safeTrackingPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.startsWith('/')
    && !normalized.includes('?')
    && !normalized.includes('#')
    && normalized.length <= 500
    ? normalized
    : null;
}

function safeTrackingMetric(value: unknown, maximum: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0
    ? Math.min(Math.round(numeric), maximum)
    : 0;
}

function isValidLeadName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().replace(/\s+/g, ' ');
  const placeholderKey = normalized.toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
  return normalized.length >= 2
    && normalized.length <= 50
    && !PLACEHOLDER_NAMES.has(placeholderKey);
}

function isValidLeadPhone(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || /^(?:-|n\/?a|none|unknown|없음|미입력)$/i.test(trimmed)) return false;
  if (/[^0-9+()\s-]/.test(trimmed)) return false;

  const digits = trimmed.replace(/\D/g, '');
  if (!/^(?:0\d{8,10}|82\d{9,10})$/.test(digits)) return false;
  return new Set(digits).size > 1;
}

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, { limit: 10, window: 60, prefix: 'rl-leads' });
  if (limited) return limited;

  try {
    const body = await req.json();
    const {
      productId,
      channel,
      form,
      tracking,
      submittedAt,
      chatSessionId,
      idempotencyKey,
      attribution: rawAttribution,
    } = body;
    const attribution = normalizeServerAttribution(rawAttribution);

    if (
      typeof productId !== 'string'
      || !productId.trim()
      || !form
      || !isValidLeadName(form.name)
      || !isValidLeadPhone(form.phone)
      || form.privacyConsent !== true
    ) {
      return ApiErrors.badRequest('이름과 연락처를 정확히 입력하고 개인정보 안내에 직접 동의해주세요.');
    }

    const validatedForm = {
      ...form,
      name: form.name.trim().replace(/\s+/g, ' '),
      phone: form.phone.trim(),
      message: typeof form.message === 'string' ? form.message.trim().slice(0, 1000) : null,
      privacyConsent: true,
    };

    const affRaw = req.cookies.get('aff_ref')?.value || null;
    const affCanon = affRaw?.trim() ? normalizeAffiliateReferralCode(affRaw) : '';
    const affRef = affCanon || null;
    const safeChannel = safeTrackingValue(channel) ?? 'organic';

    const replay = await findExistingLandingBookingReplay({
      productId,
      channel: safeChannel,
      form: validatedForm,
      tracking,
      chatSessionId,
      leadId: null,
      affiliateRef: affRef,
      idempotencyKey,
      attribution,
    });
    if (replay) {
      return successResponse({
        ok: true,
        lead_id: null,
        booking: replay.booking,
        idempotent_replay: true,
      });
    }

    const { data: insertedLead, error } = await supabase.from('leads').insert({
      product_id: productId,
      channel: safeChannel,
      desired_date: validatedForm.desiredDate || null,
      adults: validatedForm.adults,
      children: validatedForm.children,
      name: validatedForm.name,
      phone: validatedForm.phone,
      privacy_consent: validatedForm.privacyConsent,
      session_id: safeTrackingValue(tracking?.sessionId),
      utm_source: affRef || safeTrackingValue(tracking?.utmSource),
      utm_medium: safeTrackingValue(tracking?.utmMedium),
      utm_campaign: safeTrackingValue(tracking?.utmCampaign),
      utm_content: safeTrackingValue(tracking?.utmContent),
      utm_term: safeTrackingValue(tracking?.utmTerm),
      referrer: safeTrackingValue(tracking?.referrer),
      landing_url: safeTrackingPath(tracking?.landingUrl),
      scroll_depth_reached: safeTrackingMetric(tracking?.scrollDepthReached, 100),
      time_on_page_seconds: safeTrackingMetric(tracking?.timeOnPageSeconds, 86_400),
      itinerary_viewed: tracking?.itineraryViewed || false,
      attribution_snapshot: attribution,
      submitted_at: submittedAt || new Date().toISOString(),
    }).select('id').single();

    if (error) {
      console.error('[leads] supabase error:', error);
      return ApiErrors.internalError(error.message);
    }

    const bookingResult = await createLandingBookingRequest({
      productId,
      channel: safeChannel,
      form: validatedForm,
      tracking,
      chatSessionId,
      leadId: insertedLead?.id ?? null,
      affiliateRef: affRef,
      idempotencyKey,
      attribution,
    });

    try {
      const customerId = bookingResult.customerId;
      if (customerId && chatSessionId) {
        await supabase
          .from('conversations')
          .update({ customer_id: customerId })
          .eq('id', chatSessionId)
          .is('customer_id', null);

        await supabase
          .from('customer_facts')
          .update({ customer_id: customerId })
          .eq('conversation_id', chatSessionId)
          .is('customer_id', null);
      }
    } catch (e) {
      console.warn('[leads] customer backlink failed:', e);
    }

    if (insertedLead?.id) {
      try {
        await recordServerAnalyticsEvent({
          eventName: 'generate_lead',
          idempotencyKey: `lead:${insertedLead.id}`,
          sourceType: 'lead',
          sourceId: insertedLead.id as string,
          leadId: insertedLead.id as string,
          bookingId: bookingResult.booking?.id ?? null,
          productId,
          attribution,
          payload: {
            lead_source: 'website',
            lead_type: 'package_inquiry',
            package_id: productId,
          },
        });
      } catch (analyticsError) {
        console.warn('[leads] analytics event recording failed:', analyticsError);
      }
    }

    return successResponse({
      ok: true,
      lead_id: insertedLead?.id ?? null,
      booking: bookingResult.booking,
      idempotent_replay: bookingResult.idempotentReplay,
    });
  } catch (err) {
    console.error('[leads] unexpected error:', err);
    return ApiErrors.internalError(err instanceof Error ? err.message : 'Internal server error');
  }
}
