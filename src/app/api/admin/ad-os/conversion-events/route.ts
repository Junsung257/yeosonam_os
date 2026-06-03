import { NextRequest, NextResponse } from 'next/server';
import { sanitizeAdOsConversionPayload } from '@/lib/ad-os-v141-v160';
import { classifyAdOsConversionSignal } from '@/lib/ad-os-v8-v12';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const sanitized = sanitizeAdOsConversionPayload(body);
  const eventType = String(body.event_type || body.eventType || 'click');
  const classification = classifyAdOsConversionSignal({
    eventType,
    userAgent: request.headers.get('user-agent'),
    isTest: body.is_test === true,
    isAdmin: body.is_admin === true,
    isBot: body.is_bot === true,
    revenueKrw: Number(body.revenue_krw || 0),
    marginKrw: Number(body.margin_krw || 0),
    costKrw: Number(body.cost_krw || 0),
    rawPayload: sanitized.rawPayload,
  });
  const qualityFlags = {
    ...classification.qualityFlags,
    ...sanitized.qualityFlags,
  };

  const { data, error } = await supabaseAdmin
    .from('ad_os_conversion_events')
    .insert({
      tenant_id: body.tenant_id || null,
      event_type: eventType,
      platform: body.platform || null,
      source: body.source || 'ad_os_conversion_events_api',
      session_id: body.session_id || null,
      visitor_id: body.visitor_id || null,
      click_id: body.click_id || null,
      gclid: body.gclid || null,
      gbraid: body.gbraid || null,
      wbraid: body.wbraid || null,
      naver_click_id: body.naver_click_id || null,
      fbclid: body.fbclid || null,
      utm_source: body.utm_source || null,
      utm_medium: body.utm_medium || null,
      utm_campaign: body.utm_campaign || null,
      utm_content: body.utm_content || null,
      utm_term: body.utm_term || null,
      product_id: body.product_id || null,
      scenario_id: body.scenario_id || null,
      ad_landing_mapping_id: body.ad_landing_mapping_id || null,
      content_creative_id: body.content_creative_id || null,
      ad_campaign_id: body.ad_campaign_id || null,
      ad_creative_id: body.ad_creative_id || null,
      keyword_plan_id: body.keyword_plan_id || null,
      keyword_text: body.keyword_text || null,
      search_term: body.search_term || null,
      booking_id: body.booking_id || null,
      revenue_krw: Math.max(0, Math.round(Number(body.revenue_krw || 0))),
      margin_krw: Math.round(Number(body.margin_krw || 0)),
      cost_krw: Math.max(0, Math.round(Number(body.cost_krw || 0))),
      is_test: body.is_test === true,
      is_admin: body.is_admin === true,
      is_bot: body.is_bot === true,
      quarantine_status: classification.quarantineStatus,
      quality_flags: json(qualityFlags),
      raw_payload: json(sanitized.rawPayload),
    })
    .select('id, tenant_id, quarantine_status')
    .single();

  if (error || !data) {
    return NextResponse.json({ ok: false, error: error?.message || 'conversion event insert failed' }, { status: 500 });
  }

  if (classification.quarantineStatus !== 'clean') {
    await supabaseAdmin.from('ad_os_signal_quarantine').insert({
      tenant_id: data.tenant_id,
      conversion_event_id: data.id,
      source_table: 'ad_os_conversion_events',
      source_id: data.id,
      reason: classification.reasons.join(', ') || 'conversion signal requires review',
      severity: classification.quarantineStatus === 'quarantined' ? 'high' : 'medium',
      excluded_from_learning: classification.excludedFromLearning,
      excluded_from_platform_upload: classification.excludedFromPlatformUpload,
      evidence: json({ reasons: classification.reasons, quality_flags: qualityFlags }),
    });
  }

  return NextResponse.json({
    ok: true,
    event: data,
    classification: {
      ...classification,
      qualityFlags,
    },
    pii_redaction: {
      raw_pii_removed: sanitized.redactedKeys.length > 0,
      redacted_key_count: sanitized.redactedKeys.length,
      first_party_hashes_present: Object.keys(sanitized.firstPartyHashes).length > 0,
    },
  });
});
