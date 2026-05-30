import { NextRequest } from 'next/server';
import { successResponse, ApiErrors } from '@/lib/api-response';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { createLandingBookingRequest } from '@/lib/lead-booking-request';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { productId, channel, form, tracking, submittedAt, chatSessionId, idempotencyKey } = body;

    if (!productId || !form?.name || !form?.phone || !form?.privacyConsent) {
      return ApiErrors.badRequest('필수 항목 누락');
    }

    const affRaw = req.cookies.get('aff_ref')?.value || null;
    const affCanon = affRaw?.trim() ? normalizeAffiliateReferralCode(affRaw) : '';
    const affRef = affCanon || null;

    const { data: insertedLead, error } = await supabase.from('leads').insert({
      product_id: productId,
      channel,
      desired_date: form.desiredDate || null,
      adults: form.adults,
      children: form.children,
      name: form.name,
      phone: form.phone,
      privacy_consent: form.privacyConsent,
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
    }).select('id').single();

    if (error) {
      console.error('[leads] supabase error:', error);
      return ApiErrors.internalError(error.message);
    }

    const bookingResult = await createLandingBookingRequest({
      productId,
      channel,
      form,
      tracking,
      chatSessionId,
      leadId: insertedLead?.id ?? null,
      affiliateRef: affRef,
      idempotencyKey,
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
