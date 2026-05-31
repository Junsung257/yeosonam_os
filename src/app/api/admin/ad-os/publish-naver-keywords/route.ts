import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { createNaverPausedKeywords, fetchNaverAdgroupById, getNaverAdsConfigStatus } from '@/lib/search-ads-api';

export const dynamic = 'force-dynamic';

type KeywordRow = {
  id: string;
  keyword_text: string;
  suggested_bid_krw: number | null;
  external_keyword_id: string | null;
  external_ad_group_id: string | null;
  autopilot_status: string | null;
  plan_status: string | null;
};

function jsonState(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value));
}

function getNaverAdgroupId(): string {
  return (
    process.env.NAVER_ADS_ADGROUP_ID ||
    process.env.NAVER_ADS_NCC_ADGROUP_ID ||
    ''
  ).trim();
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body.mode === 'guarded' || body.mode === 'full' ? body.mode : 'dry_run';
  const apply = mode !== 'dry_run' && body.apply === true;
  const limit = Math.min(Math.max(Number(body.limit || 20), 1), 100);
  const naverConfig = getNaverAdsConfigStatus();

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'candidate_generation',
      mode,
      platform: 'naver',
      status: 'running',
      summary: { apply, limit, publisher: 'naver_paused_keyword_publish' },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || '네이버 publisher 실행 로그 생성 실패' }, { status: 500 });
  }

  const [budgetRes, keywordRes] = await Promise.all([
    supabaseAdmin
      .from('ad_os_channel_budgets')
      .select('platform,status,monthly_budget_krw,daily_budget_cap_krw,max_cpc_krw,external_ad_group_id')
      .eq('platform', 'naver')
      .maybeSingle(),
    supabaseAdmin
      .from('search_ad_keyword_plans')
      .select('id, keyword_text, suggested_bid_krw, external_keyword_id, external_ad_group_id, autopilot_status, plan_status')
      .eq('platform', 'naver')
      .eq('plan_status', 'approved')
      .in('autopilot_status', ['approved', 'testing'])
      .neq('tier', 'negative')
      .is('external_keyword_id', null)
      .order('created_at', { ascending: true })
      .limit(limit),
  ]);

  const firstError = budgetRes.error || keywordRes.error;
  if (firstError) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: firstError.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });
  }

  const budget = budgetRes.data as { status?: string; monthly_budget_krw?: number; daily_budget_cap_krw?: number; max_cpc_krw?: number; external_ad_group_id?: string | null } | null;
  const nccAdgroupId = String(body.nccAdgroupId || budget?.external_ad_group_id || getNaverAdgroupId()).trim();
  const adgroupVerification = nccAdgroupId ? await fetchNaverAdgroupById(nccAdgroupId) : null;
  const budgetReady = Boolean(budget && budget.status === 'active' && Number(budget.monthly_budget_krw) > 0 && Number(budget.daily_budget_cap_krw) > 0);
  const adgroupReady = Boolean(adgroupVerification?.ok && adgroupVerification.adgroup);
  const ready = naverConfig.configured && Boolean(nccAdgroupId) && adgroupReady;
  const rows = (keywordRes.data || []) as KeywordRow[];
  const maxCpc = Number(budget?.max_cpc_krw || 0);
  const allowedRows = rows.filter((row) => maxCpc <= 0 || Number(row.suggested_bid_krw || 0) <= maxCpc);
  const blockedByCpc = rows.length - allowedRows.length;
  const canPublish = ready && budgetReady && allowedRows.length > 0;

  const decisions = rows.map((row) => {
    const bid = Number(row.suggested_bid_krw || 0);
    const bidAllowed = maxCpc <= 0 || bid <= maxCpc;
    const eligible = ready && budgetReady && bidAllowed;
    return {
      run_id: run.id,
      platform: 'naver',
      decision_type: eligible ? 'start_test' : 'no_change',
      target_table: 'search_ad_keyword_plans',
      target_id: row.id,
      before_state: jsonState({ autopilot_status: row.autopilot_status, external_keyword_id: row.external_keyword_id, bid }),
      after_state: jsonState({ external_publish: eligible ? 'paused_keyword_ready' : 'blocked', ncc_adgroup_id: nccAdgroupId || null }),
      reason: eligible
        ? '네이버 기존 광고그룹에 userLock=true 정지 키워드로 업로드할 수 있습니다. 광고비는 즉시 지출되지 않습니다.'
        : !naverConfig.configured
          ? '네이버 검색광고 API 키가 부족합니다.'
          : !nccAdgroupId
            ? 'NAVER_ADS_ADGROUP_ID가 없어 어느 광고그룹에 넣을지 결정할 수 없습니다.'
            : !adgroupReady
              ? `저장된 네이버 광고그룹 ID가 API에서 검증되지 않았습니다. ${adgroupVerification?.error || ''}`.trim()
            : !budgetReady
              ? '네이버 예산 캡이 active가 아니거나 월/일 예산이 없습니다.'
              : `추천 입찰가 ${bid.toLocaleString('ko-KR')}원이 Max CPC ${maxCpc.toLocaleString('ko-KR')}원을 초과합니다.`,
      confidence: eligible ? 0.82 : 0.64,
      expected_impact: jsonState({ user_lock: true, bid_krw: bid, max_cpc_krw: maxCpc }),
      applied: false,
      blocked_reason: eligible ? null : 'guardrail',
    };
  });

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

  let created = 0;
  let publishError: string | null = null;
  if (apply && canPublish) {
    const result = await createNaverPausedKeywords({
      nccAdgroupId,
      keywords: allowedRows.map((row) => ({ keyword: row.keyword_text, bidAmt: Number(row.suggested_bid_krw || 70) })),
    });

    if (!result.ok) {
      publishError = result.error || 'Naver keyword create failed';
    } else {
      created = result.created.length;
      for (let index = 0; index < result.created.length; index += 1) {
        const createdKeyword = result.created[index];
        const row = allowedRows[index];
        if (!row || !createdKeyword?.nccKeywordId) continue;
        await supabaseAdmin
          .from('search_ad_keyword_plans')
          .update({
            external_ad_group_id: createdKeyword.nccAdgroupId || nccAdgroupId,
            external_keyword_id: createdKeyword.nccKeywordId,
            autopilot_status: 'testing',
            last_decision_at: new Date().toISOString(),
            decision_reason: 'Published to Naver as paused keyword by Ad OS.',
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
      }
      if (created > 0) {
        await supabaseAdmin
          .from('ad_os_decision_logs')
          .update({ applied: true })
          .eq('run_id', run.id)
          .eq('decision_type', 'start_test');
      }
    }
  }

  const summary = {
    checked_keywords: rows.length,
    eligible_keywords: decisions.filter((row) => row.decision_type === 'start_test').length,
    blocked_keywords: decisions.filter((row) => row.decision_type !== 'start_test').length,
    blocked_by_cpc: blockedByCpc,
    naver_configured: naverConfig.configured,
    ncc_adgroup_id_configured: Boolean(nccAdgroupId),
    ncc_adgroup_id_verified: adgroupReady,
    ncc_adgroup_lookup_error: adgroupVerification?.ok === false ? adgroupVerification.error : null,
    budget_ready: budgetReady,
    created_keywords: created,
    applied: created > 0,
    publish_error: publishError,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({
      status: publishError ? 'blocked' : 'completed',
      finished_at: new Date().toISOString(),
      summary,
      errors: publishError ? [{ message: publishError }] : [],
    })
    .eq('id', run.id);

  return NextResponse.json({ ok: !publishError, run_id: run.id, summary, decisions: decisions.slice(0, 30), error: publishError || undefined });
});
