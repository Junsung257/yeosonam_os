import { NextRequest, NextResponse } from 'next/server';
import { buildGoogleCampaignDraftPacket, type PacketSeed } from '@/lib/ad-os-v76-v85';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { loadAdapterCapabilities } from '../../_shared';

export const dynamic = 'force-dynamic';

type CreativeVariantRow = {
  id: string;
  tenant_id: string | null;
  product_id: string | null;
  headline: string | null;
  body: string | null;
  destination_url: string | null;
  lifecycle_status: string | null;
  generation_payload: Record<string, any> | null;
};

type KeywordPlanRow = {
  id: string;
  package_id: string | null;
  campaign_name: string | null;
  ad_group_name: string | null;
  keyword_text: string | null;
  suggested_bid_krw: number | null;
  max_cpc_krw: number | null;
  test_budget_cap_krw: number | null;
  landing_url: string | null;
  utm_url: string | null;
  opportunity_score: number | null;
};

function clean(value: unknown, fallback = ''): string {
  const text = String(value || '').trim();
  return text || fallback;
}

function firstDescription(body: string | null | undefined): string | null {
  const line = clean(body).split('\n').map((item) => item.trim()).find(Boolean);
  return line || null;
}

function packetSeedFromRows(creative: CreativeVariantRow, keyword: KeywordPlanRow | null): PacketSeed {
  const payload = creative.generation_payload || {};
  const rsa = payload.rsa && typeof payload.rsa === 'object' ? payload.rsa : {};
  const campaignName = clean(keyword?.campaign_name, `YSN Google Draft ${creative.product_id || creative.id}`);
  const adGroupName = clean(keyword?.ad_group_name, clean(keyword?.keyword_text, 'search-intent'));
  const landingUrl = clean(keyword?.utm_url || keyword?.landing_url || creative.destination_url, `/packages/${creative.product_id || ''}`);

  return {
    tenantId: creative.tenant_id,
    productId: creative.product_id,
    keyword: clean(keyword?.keyword_text || (Array.isArray(payload.target_keywords) ? payload.target_keywords[0] : null), clean(rsa.core_keywords?.[0], 'travel package')),
    landingUrl,
    headline: clean(creative.headline),
    description: firstDescription(creative.body) || clean(rsa.descriptions?.[0]),
    campaignName,
    adGroupName,
    maxCpcKrw: Number(keyword?.max_cpc_krw || keyword?.suggested_bid_krw || 0) || null,
    dailyBudgetKrw: Number(keyword?.test_budget_cap_krw || 0) || null,
  };
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = body.apply !== false;
  const tenantId = body.tenant_id ? String(body.tenant_id) : null;
  const productId = body.product_id ? String(body.product_id) : null;
  const limit = Math.min(Math.max(Number(body.limit || 10), 1), 50);
  const includeDrafts = body.include_drafts === true;

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'platform_write_packet',
      mode: 'dry_run',
      status: 'running',
      summary: {
        platform: 'google',
        source: 'google_draft_from_rsa_v1',
        apply,
        external_api_write: false,
        external_spend_krw: 0,
      },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  try {
    const capabilities = await loadAdapterCapabilities();
    const capability = capabilities.find((item) => item.platform === 'google');
    if (!capability) throw new Error('No google adapter capability found.');

    let creativeQuery = supabaseAdmin
      .from('ad_os_creative_asset_variants')
      .select('id, tenant_id, product_id, headline, body, destination_url, lifecycle_status, generation_payload')
      .eq('platform', 'google')
      .eq('asset_type', 'rsa_headline')
      .in('lifecycle_status', includeDrafts ? ['draft', 'approved', 'testing'] : ['approved', 'testing'])
      .order('created_at', { ascending: false })
      .limit(limit);

    if (tenantId) creativeQuery = creativeQuery.eq('tenant_id', tenantId);
    if (productId) creativeQuery = creativeQuery.eq('product_id', productId);

    const { data: creatives, error: creativeError } = await creativeQuery;
    if (creativeError) throw creativeError;

    const creativeRows = (creatives || []) as CreativeVariantRow[];
    const productIds = Array.from(new Set(creativeRows.map((row) => row.product_id).filter(Boolean))) as string[];

    const keywordRows: KeywordPlanRow[] = [];
    if (productIds.length > 0) {
      let keywordQuery = supabaseAdmin
        .from('search_ad_keyword_plans')
        .select('id, package_id, campaign_name, ad_group_name, keyword_text, suggested_bid_krw, max_cpc_krw, test_budget_cap_krw, landing_url, utm_url, opportunity_score')
        .eq('platform', 'google')
        .in('package_id', productIds)
        .in('autopilot_status', ['approved', 'testing', 'active'])
        .order('opportunity_score', { ascending: false })
        .limit(200);
      if (tenantId) keywordQuery = keywordQuery.eq('tenant_id', tenantId);
      const { data, error } = await keywordQuery;
      if (error) throw error;
      keywordRows.push(...((data || []) as KeywordPlanRow[]));
    }

    const bestKeywordByProduct = new Map<string, KeywordPlanRow>();
    for (const keyword of keywordRows) {
      if (keyword.package_id && !bestKeywordByProduct.has(keyword.package_id)) {
        bestKeywordByProduct.set(keyword.package_id, keyword);
      }
    }

    const packets = creativeRows.map((creative) => {
      const seed = packetSeedFromRows(creative, creative.product_id ? bestKeywordByProduct.get(creative.product_id) || null : null);
      return {
        ...buildGoogleCampaignDraftPacket(capability, { ...seed, runId: run.id }),
        run_id: run.id,
        response_payload: {
          dry_run: true,
          external_api_write: false,
          next_step: 'execution_gate_monitor_only',
          source_creative_variant_id: creative.id,
          source_keyword_plan_id: creative.product_id ? bestKeywordByProduct.get(creative.product_id)?.id || null : null,
        },
      };
    });

    let written = 0;
    if (apply && packets.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('ad_os_platform_write_packets')
        .upsert(packets as never, { onConflict: 'platform,idempotency_key' })
        .select('id');
      if (error) throw error;
      written = data?.length || 0;
    }

    const summary = {
      apply,
      source: 'google_draft_from_rsa_v1',
      creatives_checked: creativeRows.length,
      keyword_plans_checked: keywordRows.length,
      packets_prepared: packets.length,
      packets_written: written,
      blocked_packets: packets.filter((packet) => packet.lifecycle_status === 'blocked').length,
      ready_packets: packets.filter((packet) => packet.lifecycle_status === 'ready').length,
      external_api_write: false,
      external_spend_krw: 0,
    };

    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
      .eq('id', run.id);

    return NextResponse.json({ ok: true, run_id: run.id, dry_run: !apply, summary, packets });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'google draft packet generation failed';
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
});
