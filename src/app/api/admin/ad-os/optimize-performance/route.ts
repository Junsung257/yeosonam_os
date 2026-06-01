import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type MappingRow = {
  id: string;
  platform: string;
  keyword: string | null;
  operational_status: string | null;
  active: boolean | null;
  clicks: number | null;
  cta_clicks: number | null;
  conversions: number | null;
  conversion_value_krw: number | null;
  quality_flags: Record<string, unknown> | null;
};

function jsonState(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value));
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function decideMapping(row: MappingRow): {
  decision_type: 'pause' | 'scale' | 'no_change';
  next_status: string;
  active: boolean;
  reason: string;
  confidence: number;
  expected_impact: Record<string, unknown>;
} {
  const clicks = Number(row.clicks || 0);
  const ctaClicks = Number(row.cta_clicks || 0);
  const conversions = Number(row.conversions || 0);
  const value = Number(row.conversion_value_krw || 0);
  const ctaRate = rate(ctaClicks, clicks);
  const conversionRate = rate(conversions, clicks);
  const currentStatus = row.operational_status || 'candidate';

  if (clicks >= 30 && ctaClicks === 0 && conversions === 0) {
    return {
      decision_type: 'pause',
      next_status: 'paused',
      active: false,
      reason: '클릭은 충분하지만 CTA/예약 신호가 없어 예산 누수를 막기 위해 정지 후보입니다.',
      confidence: 0.78,
      expected_impact: { clicks, cta_clicks: ctaClicks, conversions, cta_rate: ctaRate, conversion_rate: conversionRate },
    };
  }

  if (clicks >= 15 && ctaRate < 0.02 && conversions === 0) {
    return {
      decision_type: 'pause',
      next_status: 'paused',
      active: false,
      reason: 'CTA 전환율이 낮아 랜딩/키워드 정합성 개선 전까지 정지 후보입니다.',
      confidence: 0.7,
      expected_impact: { clicks, cta_clicks: ctaClicks, conversions, cta_rate: ctaRate, conversion_rate: conversionRate },
    };
  }

  if (conversions > 0 || value > 0 || (clicks >= 10 && ctaRate >= 0.08)) {
    return {
      decision_type: currentStatus === 'winning' || currentStatus === 'scaled' ? 'no_change' : 'scale',
      next_status: currentStatus === 'scaled' ? 'scaled' : 'winning',
      active: true,
      reason: 'CTA/예약 신호가 좋아 예산 확장 또는 유사 키워드 생성 후보입니다.',
      confidence: conversions > 0 ? 0.86 : 0.74,
      expected_impact: { clicks, cta_clicks: ctaClicks, conversions, value_krw: value, cta_rate: ctaRate, conversion_rate: conversionRate },
    };
  }

  return {
    decision_type: 'no_change',
    next_status: currentStatus,
    active: Boolean(row.active),
    reason: '아직 클릭/CTA/예약 표본이 부족해 추가 학습이 필요합니다.',
    confidence: 0.58,
    expected_impact: { clicks, cta_clicks: ctaClicks, conversions, cta_rate: ctaRate, conversion_rate: conversionRate },
  };
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body.mode === 'guarded' || body.mode === 'full' ? body.mode : 'dry_run';
  const apply = mode !== 'dry_run' && body.apply === true;
  const limit = Math.min(Math.max(Number(body.limit || 100), 1), 300);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'bid_optimization',
      mode,
      status: 'running',
      summary: { apply, limit, optimizer: 'mapping_performance_v1' },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || '최적화 실행 로그 생성 실패' }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin
    .from('ad_landing_mappings')
    .select('id, platform, keyword, operational_status, active, clicks, cta_clicks, conversions, conversion_value_krw, quality_flags')
    .in('operational_status', ['testing', 'active', 'winning', 'scaled'])
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const mappings = (data || []) as MappingRow[];
  const decisions = mappings.map((mapping) => {
    const decision = decideMapping(mapping);
    return {
      run_id: run.id,
      platform: mapping.platform,
      decision_type: decision.decision_type,
      target_table: 'ad_landing_mappings',
      target_id: mapping.id,
      before_state: jsonState({
        operational_status: mapping.operational_status,
        active: mapping.active,
        clicks: mapping.clicks,
        cta_clicks: mapping.cta_clicks,
        conversions: mapping.conversions,
      }),
      after_state: jsonState({
        operational_status: decision.next_status,
        active: decision.active,
        optimization: decision.expected_impact,
      }),
      reason: decision.reason,
      confidence: decision.confidence,
      expected_impact: jsonState(decision.expected_impact),
      applied: false,
      blocked_reason: decision.decision_type === 'no_change' ? 'insufficient_signal' : null,
    };
  });

  if (decisions.length > 0) {
    const { error: decisionError } = await supabaseAdmin.from('ad_os_decision_logs').insert(decisions);
    if (decisionError) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: decisionError.message }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: decisionError.message }, { status: 500 });
    }

    const changeRequests = decisions
      .filter((row) => row.decision_type === 'pause' || row.decision_type === 'scale')
      .map((decision) => ({
        run_id: run.id,
        platform: decision.platform,
        automation_level: decision.decision_type === 'scale' ? 3 : 2,
        request_type: decision.decision_type === 'pause' ? 'replace_landing' : 'create_keyword',
        target_table: decision.target_table,
        target_id: decision.target_id,
        status: 'proposed',
        title: decision.decision_type === 'pause' ? '저성과 랜딩 정지/교체 검토' : '성과 좋은 랜딩 확장 검토',
        reason: decision.reason,
        risk_level: decision.decision_type === 'scale' ? 'high' : 'medium',
        expected_impact: decision.expected_impact,
        proposed_change: decision.after_state,
        rollback_payload: decision.before_state,
        approval_required: true,
      }));
    if (changeRequests.length > 0) {
      const { error: requestError } = await supabaseAdmin.from('ad_os_change_requests').insert(changeRequests);
      if (requestError) {
        await supabaseAdmin
          .from('ad_os_automation_runs')
          .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: requestError.message }] })
          .eq('id', run.id);
        return NextResponse.json({ ok: false, error: requestError.message }, { status: 500 });
      }
    }
  }

  let appliedCount = 0;
  if (apply) {
    for (const decision of decisions.filter((row) => row.decision_type === 'pause' || row.decision_type === 'scale')) {
      const after = decision.after_state as { operational_status: string; active: boolean; optimization?: Record<string, unknown> };
      const beforeMapping = mappings.find((row) => row.id === decision.target_id);
      const qualityFlags = {
        ...(beforeMapping?.quality_flags || {}),
        last_optimizer: 'mapping_performance_v1',
        last_optimizer_decision: decision.decision_type,
        last_optimizer_impact: after.optimization || {},
      };
      const { error: updateError } = await supabaseAdmin
        .from('ad_landing_mappings')
        .update({
          operational_status: after.operational_status,
          active: after.active,
          quality_flags: qualityFlags,
          last_decision_at: new Date().toISOString(),
          decision_reason: decision.reason,
        })
        .eq('id', decision.target_id);

      if (updateError) {
        await supabaseAdmin
          .from('ad_os_automation_runs')
          .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: updateError.message }] })
          .eq('id', run.id);
        return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
      }
      appliedCount += 1;
    }

    if (appliedCount > 0) {
      await supabaseAdmin
        .from('ad_os_decision_logs')
        .update({ applied: true })
        .eq('run_id', run.id)
        .in('decision_type', ['pause', 'scale']);
    }
  }

  const summary = {
    checked_mappings: mappings.length,
    pause_candidates: decisions.filter((row) => row.decision_type === 'pause').length,
    scale_candidates: decisions.filter((row) => row.decision_type === 'scale').length,
    no_change: decisions.filter((row) => row.decision_type === 'no_change').length,
    applied: appliedCount > 0,
    applied_count: appliedCount,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, decisions: decisions.slice(0, 30) });
});
