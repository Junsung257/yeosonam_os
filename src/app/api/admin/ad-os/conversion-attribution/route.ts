import { NextRequest, NextResponse } from 'next/server';
import {
  buildAttributionSummary,
  normalizeConversionEventsToPerformanceFacts,
  type ConversionEventForAttribution,
} from '@/lib/ad-os-v26-v30';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type ConversionAttributionBody = {
  days?: number;
  apply?: boolean;
  limit?: number;
  tenant_id?: string | null;
};

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as ConversionAttributionBody;
  const days = Math.min(Math.max(Number(body.days || 30), 1), 120);
  const limit = Math.min(Math.max(Number(body.limit || 2000), 1), 5000);
  const apply = body.apply !== false;
  const tenantId = typeof body.tenant_id === 'string' && body.tenant_id ? body.tenant_id : null;
  const fromIso = sinceIso(days);
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = fromIso.slice(0, 10);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'conversion_ingest',
      mode: apply ? 'guarded' : 'dry_run',
      status: 'running',
      summary: { days, apply, tenant_id: tenantId, source: 'conversion_attribution_v26' },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  let eventQuery = supabaseAdmin
    .from('ad_os_conversion_events')
    .select(`
      id, tenant_id, event_type, event_time, platform, product_id, scenario_id,
      ad_landing_mapping_id, content_creative_id, ad_campaign_id, ad_creative_id,
      keyword_text, search_term, revenue_krw, margin_krw, cost_krw,
      quarantine_status, raw_payload
    `)
    .gte('event_time', fromIso)
    .order('event_time', { ascending: true })
    .limit(limit);

  if (tenantId) eventQuery = eventQuery.eq('tenant_id', tenantId);

  const { data: events, error: eventError } = await eventQuery;
  if (eventError) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: eventError.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: eventError.message }, { status: 500 });
  }

  const facts = normalizeConversionEventsToPerformanceFacts((events || []) as ConversionEventForAttribution[]);
  const summary = {
    days,
    apply,
    tenant_id: tenantId,
    events_checked: events?.length || 0,
    clean_events: (events || []).filter((event: any) => !event.quarantine_status || event.quarantine_status === 'clean').length,
    quarantined_or_review_events: (events || []).filter((event: any) => event.quarantine_status && event.quarantine_status !== 'clean').length,
    ...buildAttributionSummary(facts),
  };

  if (apply) {
    let deleteQuery = supabaseAdmin
      .from('ad_os_performance_facts')
      .delete()
      .eq('source', 'conversion_events_attribution')
      .gte('event_date', fromDate)
      .lte('event_date', today);
    if (tenantId) deleteQuery = deleteQuery.eq('tenant_id', tenantId);

    const { error: deleteError } = await deleteQuery;
    if (deleteError) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: deleteError.message }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: deleteError.message }, { status: 500 });
    }

    if (facts.length > 0) {
      const { error: insertError } = await supabaseAdmin.from('ad_os_performance_facts').insert(
        facts.map((fact) => ({
          ...fact,
          metrics: {
            ...fact.metrics,
            run_id: run.id,
          },
          updated_at: new Date().toISOString(),
        })),
      );
      if (insertError) {
        await supabaseAdmin
          .from('ad_os_automation_runs')
          .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: insertError.message }] })
          .eq('id', run.id);
        return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
      }
    }
  }

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({
    ok: true,
    run_id: run.id,
    summary,
    sample: facts.slice(0, 20),
  });
});
