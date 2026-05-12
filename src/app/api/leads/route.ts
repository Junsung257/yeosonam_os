import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { findOrCreateCustomerByPhone } from '@/lib/supabase';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { getSecret } from '@/lib/secret-registry';

const supabase = createClient(
  getSecret('NEXT_PUBLIC_SUPABASE_URL')!,
  getSecret('SUPABASE_SERVICE_ROLE_KEY')!
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { productId, channel, form, tracking, submittedAt, chatSessionId } = body;

    if (!productId || !form?.name || !form?.phone || !form?.privacyConsent) {
      return NextResponse.json({ error: '필수 항목 누락' }, { status: 400 });
    }

    // 인플루언서/제휴 추천인 코드 (미들웨어가 ?ref= 파라미터에서 쿠키로 저장)
    const affRaw = req.cookies.get('aff_ref')?.value || null;
    const affCanon = affRaw?.trim() ? normalizeAffiliateReferralCode(affRaw) : '';
    const affRef = affCanon || null;

    const { error } = await supabase.from('leads').insert({
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
    });

    if (error) {
      console.error('[leads] supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // ── P4.5: 고객 식별 + 채팅 세션 역참조 ──
    // 실패해도 lead 저장은 이미 성공 — 사용자 흐름에 영향 주지 않기 위해 try로 감싸고 skip
    try {
      const customerId = await findOrCreateCustomerByPhone(form.phone, form.name);
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
      console.warn('[leads] customer backlink 실패 (무시):', e);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[leads] unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
