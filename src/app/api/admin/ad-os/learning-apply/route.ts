import { NextRequest, NextResponse } from 'next/server';
import { decidePerformanceAction } from '@/lib/ad-os-v3-v7';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type LearningApplyBody = {
  apply?: boolean;
  limit?: number;
  target_cpa_krw?: number;
  target_roas?: number;
};

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function requestTypeForAction(action: ReturnType<typeof decidePerformanceAction>['action']) {
  switch (action) {
    case 'pause_keyword':
      return 'pause_keyword';
    case 'replace_landing':
      return 'replace_landing';
    case 'create_keyword':
      return 'create_keyword';
    case 'increase_budget':
      return 'budget_change';
    case 'update_blog_cta':
      return 'update_blog_cta';
    default:
      return null;
  }
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as LearningApplyBody;
  const apply = body.apply !== false;
  const limit = Math.min(Math.max(Number(body.limit || 100), 1), 500);
  const targetCpaKrw = Number(body.target_cpa_krw || 0) || null;
  const targetRoas = Number(body.target_roas || 0) || null;

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'learning_apply',
      mode: apply ? 'guarded' : 'dry_run',
      status: 'running',
      summary: { apply, limit, target_cpa_krw: targetCpaKrw, target_roas: targetRoas },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  const { data: facts, error } = await supabaseAdmin
    .from('ad_os_performance_facts')
    .select('*')
    .order('event_date', { ascending: false })
    .limit(limit);

  if (error) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const decisions = (facts || []).map((fact: any) => {
    const decision = decidePerformanceAction({
      clicks: Number(fact.clicks || 0),
      ctaClicks: Number(fact.cta_clicks || 0),
      conversions: Number(fact.conversions || 0),
      costKrw: Number(fact.cost_krw || 0),
      revenueKrw: Number(fact.revenue_krw || 0),
      marginKrw: Number(fact.margin_krw || 0),
      bounces: Number(fact.bounces || 0),
      sessions: Number(fact.sessions || 0),
      keywordText: fact.keyword_text || null,
      targetCpaKrw,
      targetRoas,
    });
    return { fact, decision };
  });

  const decisionRows = decisions.map(({ fact, decision }) => ({
    run_id: run.id,
    tenant_id: fact.tenant_id || null,
    platform: fact.platform === 'organic' ? null : fact.platform,
    decision_type:
      decision.action === 'pause_keyword'
        ? 'pause'
        : decision.action === 'create_keyword'
          ? 'create_candidate'
          : decision.action === 'increase_budget'
            ? 'increase_bid'
            : decision.action === 'no_change'
              ? 'no_change'
              : 'replace_landing',
    target_table: 'ad_os_performance_facts',
    target_id: fact.id,
    before_state: json({
      clicks: fact.clicks,
      cta_clicks: fact.cta_clicks,
      conversions: fact.conversions,
      cost_krw: fact.cost_krw,
      revenue_krw: fact.revenue_krw,
    }),
    after_state: json(decision.proposedChange),
    reason: decision.reason,
    confidence: decision.confidence,
    expected_impact: json(decision.expectedImpact),
    applied: false,
    blocked_reason: decision.action === 'no_change' ? 'insufficient_signal' : null,
  }));

  if (decisionRows.length > 0) {
    const { error: decisionError } = await supabaseAdmin.from('ad_os_decision_logs').insert(decisionRows);
    if (decisionError) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: decisionError.message }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: decisionError.message }, { status: 500 });
    }
  }

  const changeRequests = decisions
    .filter(({ decision }) => decision.action !== 'no_change')
    .map(({ fact, decision }) => {
      const requestType = requestTypeForAction(decision.action);
      const targetTable = decision.action === 'update_blog_cta'
        ? 'blog_content_versions'
        : decision.action === 'replace_landing'
          ? 'ad_os_landing_evolution_queue'
          : decision.action === 'increase_budget'
            ? 'ad_os_channel_budgets'
            : fact.ad_landing_mapping_id
              ? 'ad_landing_mappings'
              : 'search_ad_keyword_plans';
      const targetId = decision.action === 'update_blog_cta'
        ? String(fact.content_creative_id || fact.id)
        : decision.action === 'replace_landing'
          ? String(fact.ad_landing_mapping_id || fact.content_creative_id || fact.id)
          : decision.action === 'increase_budget'
            ? String(fact.platform)
            : String(fact.ad_landing_mapping_id || fact.id);

      return {
        tenant_id: fact.tenant_id || null,
        run_id: run.id,
        platform: fact.platform === 'organic' ? null : fact.platform,
        automation_level: decision.action === 'pause_keyword' || decision.action === 'update_blog_cta' ? 2 : 3,
        request_type: requestType,
        target_table: targetTable,
        target_id: targetId,
        status: 'proposed',
        title: decision.title,
        reason: decision.reason,
        risk_level: decision.riskLevel,
        expected_impact: json(decision.expectedImpact),
        proposed_change: json(decision.proposedChange),
        rollback_payload: json({ fact_id: fact.id, source: 'learning_apply_v1' }),
        approval_required: true,
      };
    })
    .filter((row) => row.request_type);

  if (apply && changeRequests.length > 0) {
    const { error: requestError } = await supabaseAdmin.from('ad_os_change_requests').insert(changeRequests);
    if (requestError) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: requestError.message }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: requestError.message }, { status: 500 });
    }
  }

  const blogVersions = decisions
    .filter(({ fact, decision }) => decision.action === 'update_blog_cta' && fact.content_creative_id)
    .map(({ fact, decision }) => ({
      tenant_id: fact.tenant_id || null,
      content_creative_id: fact.content_creative_id,
      slug: String(fact.metrics?.slug || fact.keyword_text || fact.content_creative_id),
      version_no: 1,
      change_type: 'seo_refresh',
      status: 'candidate',
      reason: decision.reason,
      evidence: json({ fact_id: fact.id, metrics: fact.metrics }),
      expected_impact: json(decision.expectedImpact),
    }));

  if (apply && blogVersions.length > 0) {
    await supabaseAdmin.from('blog_content_versions').insert(blogVersions);
  }

  const summary = {
    facts_checked: facts?.length || 0,
    decisions: decisions.length,
    change_requests_prepared: changeRequests.length,
    change_requests_inserted: apply ? changeRequests.length : 0,
    pause_candidates: decisions.filter(({ decision }) => decision.action === 'pause_keyword').length,
    landing_candidates: decisions.filter(({ decision }) => decision.action === 'replace_landing' || decision.action === 'update_blog_cta').length,
    expansion_candidates: decisions.filter(({ decision }) => decision.action === 'create_keyword' || decision.action === 'increase_budget').length,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, decisions: decisions.slice(0, 30) });
});
