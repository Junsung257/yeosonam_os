import { NextRequest } from 'next/server';
import { successResponse, ApiErrors } from '@/lib/api-response';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { createLandingBookingRequest, findExistingLandingBookingReplay } from '@/lib/lead-booking-request';
import { normalizeServerAttribution, recordServerAnalyticsEvent } from '@/lib/analytics/server-events';
import { hashAnalyticsSearchQuery } from '@/lib/analytics/query-hash';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      attribution,
      assistingContentCreativeId,
    } = body;

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
    const normalizedAttribution = normalizeServerAttribution(attribution);
    const normalizedAssistId = typeof assistingContentCreativeId === 'string'
      && UUID_RE.test(assistingContentCreativeId)
      ? assistingContentCreativeId
      : null;
    const searchQueryHash = hashAnalyticsSearchQuery(
      normalizedAttribution?.lastTouch?.term ?? normalizedAttribution?.firstTouch?.term,
    );

    const replay = await findExistingLandingBookingReplay({
      productId,
      channel,
      form: validatedForm,
      tracking,
      chatSessionId,
      leadId: null,
      affiliateRef: affRef,
      idempotencyKey,
      attribution: normalizedAttribution,
      assistingContentCreativeId: normalizedAssistId,
      searchQueryHash,
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
      channel,
      desired_date: validatedForm.desiredDate || null,
      adults: validatedForm.adults,
      children: validatedForm.children,
      name: validatedForm.name,
      phone: validatedForm.phone,
      privacy_consent: validatedForm.privacyConsent,
      session_id: tracking?.sessionId || null,
      utm_source: affRef || tracking?.utmSource || null,
      utm_medium: tracking?.utmMedium || null,
      utm_campaign: tracking?.utmCampaign || null,
      utm_content: tracking?.utmContent || null,
      utm_term: tracking?.utmTerm || null,
      referrer: tracking?.referrer || null,
      landing_url: tracking?.landingUrl || null,
      scroll_depth_reached: tracking?.scrollDepthReached || 0,
      time_on_page_seconds: tracking?.timeOnPageSeconds || 0,
      itinerary_viewed: tracking?.itineraryViewed || false,
      submitted_at: submittedAt || new Date().toISOString(),
      attribution_snapshot: normalizedAttribution,
      assisting_content_creative_id: normalizedAssistId,
      search_query_hash: searchQueryHash,
    }).select('id').single();

    if (error) {
      console.error('[leads] supabase error:', error);
      return ApiErrors.internalError(error.message);
    }

    const bookingResult = await createLandingBookingRequest({
      productId,
      channel,
      form: validatedForm,
      tracking,
      chatSessionId,
      leadId: insertedLead?.id ?? null,
      affiliateRef: affRef,
      idempotencyKey,
      attribution: normalizedAttribution,
      assistingContentCreativeId: normalizedAssistId,
      searchQueryHash,
    });

    if (insertedLead?.id) {
      try {
        await recordServerAnalyticsEvent({
          eventName: 'generate_lead',
          idempotencyKey: `lead:${insertedLead.id}`,
          sourceType: 'lead',
          sourceId: insertedLead.id,
          leadId: insertedLead.id,
          bookingId: bookingResult.booking?.id ?? null,
          productId,
          assistingContentCreativeId: normalizedAssistId,
          searchQueryHash,
          attribution: normalizedAttribution,
          payload: {
            lead_type: 'package_inquiry',
            channel: typeof channel === 'string' ? channel.slice(0, 100) : 'website',
            package_id: productId,
            assisted_by_blog: Boolean(normalizedAssistId),
          },
        });
      } catch (analyticsError) {
        console.warn('[leads] server analytics failed:', analyticsError);
      }
    }

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
