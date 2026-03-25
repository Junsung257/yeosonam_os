import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { productId, channel, form, tracking, submittedAt } = body;

    if (!productId || !form?.name || !form?.phone || !form?.privacyConsent) {
      return NextResponse.json({ error: '필수 항목 누락' }, { status: 400 });
    }

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
      utm_source: tracking?.utmSource || null,
      utm_medium: tracking?.utmMedium || null,
      utm_campaign: tracking?.utmCampaign || null,
      utm_content: tracking?.utmContent || null,
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

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[leads] unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
