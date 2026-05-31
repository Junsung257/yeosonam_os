import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const PLATFORMS = ['naver', 'google', 'meta', 'kakao'] as const;

function hasAllSecrets(names: string[]): boolean {
  return names.every((name) => Boolean(getSecret(name as never)));
}

function integrationReady(platform: string): boolean {
  if (platform === 'naver') return hasAllSecrets(['NAVER_ADS_API_KEY', 'NAVER_ADS_SECRET_KEY', 'NAVER_ADS_CUSTOMER_ID']);
  if (platform === 'google') return hasAllSecrets(['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET']);
  if (platform === 'meta') return hasAllSecrets(['META_AD_ACCOUNT_ID']) && (hasAllSecrets(['META_ACCESS_TOKEN']) || hasAllSecrets(['META_ADS_ACCESS_TOKEN']));
  return false;
}

function jsonState(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value));
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body.mode === 'guarded' || body.mode === 'full' ? body.mode : 'dry_run';
  const apply = mode !== 'dry_run' && body.apply === true;

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'full_autopilot',
      mode,
      status: 'running',
      summary: { requested_apply: apply },
    })
    .select('*')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || '자동화 실행 생성 실패' }, { status: 500 });
  }

  const [budgetRes, mappingRes, keywordRes] = await Promise.all([
    supabaseAdmin
      .from('ad_os_channel_budgets')
      .select('*')
      .is('tenant_id', null),
    supabaseAdmin
      .from('ad_landing_mappings')
      .select('id, platform, keyword, operational_status, clicks, conversions, quality_flags')
      .in('operational_status', ['candidate', 'approved', 'testing'])
      .order('created_at', { ascending: false })
      .limit(80),
    supabaseAdmin
      .from('search_ad_keyword_plans')
      .select('id, platform, keyword_text, tier, match_type, autopilot_status, suggested_bid_krw, max_cpc_krw, opportunity_score')
      .in('autopilot_status', ['candidate', 'approved', 'testing'])
      .order('created_at', { ascending: false })
      .limit(120),
  ]);

  const firstError = budgetRes.error || mappingRes.error || keywordRes.error;
  if (firstError) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: firstError.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });
  }

  const budgets = new Map((budgetRes.data || []).map((b) => [b.platform, b]));
  const decisions: Array<Record<string, unknown>> = [];

  for (const mapping of mappingRes.data || []) {
    const budget = budgets.get(mapping.platform);
    const ready = integrationReady(mapping.platform);
    const budgetReady = Boolean(budget && budget.status === 'active' && Number(budget.monthly_budget_krw) > 0 && Number(budget.daily_budget_cap_krw) > 0);
    const shouldAdvance = ready && budgetReady && mapping.operational_status === 'approved';

    decisions.push({
      run_id: run.id,
      platform: mapping.platform,
      decision_type: shouldAdvance ? 'start_test' : 'no_change',
      target_table: 'ad_landing_mappings',
      target_id: String(mapping.id),
      before_state: jsonState({ operational_status: mapping.operational_status }),
      after_state: jsonState({ operational_status: shouldAdvance ? 'testing' : mapping.operational_status }),
      reason: shouldAdvance
        ? '채널 키와 예산 가드레일이 준비되어 승인 매핑을 소액 테스트 대상으로 올릴 수 있습니다.'
        : !ready
          ? '채널 API 키가 준비되지 않아 외부 집행을 보류합니다.'
          : !budgetReady
            ? '월/일 예산이 설정되지 않아 외부 집행을 보류합니다.'
            : '후보 상태입니다. 먼저 사람이 승인하거나 L2 정책을 켜야 합니다.',
      confidence: shouldAdvance ? 0.72 : 0.55,
      expected_impact: jsonState({ spend_risk: shouldAdvance ? 'guarded' : 'none' }),
      applied: false,
      blocked_reason: shouldAdvance ? null : 'guardrail',
    });
  }

  for (const keyword of keywordRes.data || []) {
    const budget = budgets.get(keyword.platform);
    const ready = integrationReady(keyword.platform);
    const maxCpc = Number(budget?.max_cpc_krw || keyword.max_cpc_krw || 0);
    const bid = Number(keyword.suggested_bid_krw || 0);
    const budgetReady = Boolean(budget && budget.status === 'active' && Number(budget.monthly_budget_krw) > 0 && Number(budget.daily_budget_cap_krw) > 0);
    const bidAllowed = maxCpc <= 0 || bid <= maxCpc;
    const canTest = ready && budgetReady && bidAllowed && keyword.autopilot_status === 'approved';

    decisions.push({
      run_id: run.id,
      platform: keyword.platform,
      decision_type: canTest ? 'start_test' : 'no_change',
      target_table: 'search_ad_keyword_plans',
      target_id: String(keyword.id),
      before_state: jsonState({ autopilot_status: keyword.autopilot_status, suggested_bid_krw: bid }),
      after_state: jsonState({ autopilot_status: canTest ? 'testing' : keyword.autopilot_status }),
      reason: canTest
        ? '승인 키워드가 예산, Max CPC, 채널 키 조건을 통과해 소액 테스트 대상입니다.'
        : !ready
          ? '채널 API 키가 준비되지 않아 키워드 배포를 보류합니다.'
          : !budgetReady
            ? '월/일 예산이 설정되지 않아 키워드 배포를 보류합니다.'
            : !bidAllowed
              ? `추천 입찰가 ${bid.toLocaleString('ko-KR')}원이 Max CPC ${maxCpc.toLocaleString('ko-KR')}원을 초과합니다.`
              : '후보 상태입니다. 먼저 승인 또는 L2 정책 설정이 필요합니다.',
      confidence: canTest ? 0.76 : 0.58,
      expected_impact: jsonState({ bid_krw: bid, max_cpc_krw: maxCpc }),
      applied: false,
      blocked_reason: canTest ? null : 'guardrail',
    });
  }

  if (decisions.length > 0) {
    const { error } = await supabaseAdmin.from('ad_os_decision_logs').insert(decisions);
    if (error) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  let appliedCount = 0;
  const shouldApply = apply && decisions.length > 0;
  if (shouldApply) {
    const mappingIds = decisions
      .filter((d) => d.decision_type === 'start_test' && d.target_table === 'ad_landing_mappings')
      .map((d) => String(d.target_id));
    const keywordIds = decisions
      .filter((d) => d.decision_type === 'start_test' && d.target_table === 'search_ad_keyword_plans')
      .map((d) => String(d.target_id));
    appliedCount = mappingIds.length + keywordIds.length;

    if (mappingIds.length) {
      const { error } = await supabaseAdmin
        .from('ad_landing_mappings')
        .update({
          operational_status: 'testing',
          active: true,
          last_decision_at: new Date().toISOString(),
          decision_reason: 'Moved to testing by Ad OS guarded autopilot.',
        })
        .in('id', mappingIds);
      if (error) {
        await supabaseAdmin
          .from('ad_os_automation_runs')
          .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] })
          .eq('id', run.id);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
    }

    if (keywordIds.length) {
      const { error } = await supabaseAdmin
        .from('search_ad_keyword_plans')
        .update({
          autopilot_status: 'testing',
          last_decision_at: new Date().toISOString(),
          decision_reason: 'Moved to testing by Ad OS guarded autopilot.',
          updated_at: new Date().toISOString(),
        })
        .in('id', keywordIds);
      if (error) {
        await supabaseAdmin
          .from('ad_os_automation_runs')
          .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] })
          .eq('id', run.id);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
    }

    if (appliedCount > 0) {
      await supabaseAdmin
        .from('ad_os_decision_logs')
        .update({ applied: true })
        .eq('run_id', run.id)
        .eq('decision_type', 'start_test');
    }
  }

  const summary = {
    decisions: decisions.length,
    start_test_candidates: decisions.filter((d) => d.decision_type === 'start_test').length,
    blocked_by_guardrail: decisions.filter((d) => d.blocked_reason === 'guardrail').length,
    platforms_checked: PLATFORMS.length,
    applied: appliedCount > 0,
    applied_count: appliedCount,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, decisions: decisions.slice(0, 30) });
});
