import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type KeywordPlanRow = {
  id: string;
  package_id: string;
  platform: 'naver' | 'google';
  campaign_name: string;
  ad_group_name: string;
  keyword_text: string;
  tier: string;
  match_type: string;
  suggested_bid_krw: number | null;
  landing_url: string;
  utm_url: string;
  ad_campaign_id: string | null;
  ad_creative_id: string | null;
  travel_packages?: {
    title?: string | null;
    destination?: string | null;
    price?: number | null;
    ticketing_deadline?: string | null;
    status?: string | null;
  } | null;
};

function hasAllSecrets(names: string[]): boolean {
  return names.every((name) => Boolean(getSecret(name as never)));
}

function integrationReady(platform: string): boolean {
  if (platform === 'naver') return hasAllSecrets(['NAVER_ADS_API_KEY', 'NAVER_ADS_SECRET_KEY', 'NAVER_ADS_CUSTOMER_ID']);
  if (platform === 'google') return hasAllSecrets(['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET']);
  return false;
}

function jsonState(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value));
}

function groupKey(row: KeywordPlanRow): string {
  return `${row.package_id}:${row.platform}:${row.campaign_name}`;
}

function buildHeadline(row: KeywordPlanRow): string {
  const destination = row.travel_packages?.destination || row.keyword_text.split(' ')[0] || '여행';
  return `${destination} 맞춤 패키지`.slice(0, 40);
}

function buildDescription(rows: KeywordPlanRow[]): string {
  const first = rows[0];
  const price = first.travel_packages?.price ? `${Number(first.travel_packages.price).toLocaleString('ko-KR')}원~` : '상담 문의';
  return `${first.travel_packages?.title || first.keyword_text} ${price} 여소남에서 확인하세요.`.slice(0, 120);
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body.mode === 'guarded' || body.mode === 'full' ? body.mode : 'dry_run';
  const apply = mode !== 'dry_run' && body.apply === true;
  const limit = Math.min(Math.max(Number(body.limit || 40), 1), 200);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'candidate_generation',
      mode,
      status: 'running',
      summary: { apply, limit, publisher: 'search_campaign_draft' },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || '캠페인 드래프트 실행 로그 생성 실패' }, { status: 500 });
  }

  const [budgetRes, keywordRes] = await Promise.all([
    supabaseAdmin.from('ad_os_channel_budgets').select('*').in('platform', ['naver', 'google']),
    supabaseAdmin
      .from('search_ad_keyword_plans')
      .select(`
        id, package_id, platform, campaign_name, ad_group_name, keyword_text, tier, match_type,
        suggested_bid_krw, landing_url, utm_url, ad_campaign_id, ad_creative_id,
        travel_packages:package_id(title,destination,price,ticketing_deadline,status)
      `)
      .eq('plan_status', 'approved')
      .in('autopilot_status', ['approved', 'testing'])
      .neq('tier', 'negative')
      .is('ad_campaign_id', null)
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

  const budgets = new Map(
    (budgetRes.data || []).map((row) => [String(row.platform), row as { status: string; daily_budget_cap_krw: number; monthly_budget_krw: number; max_cpc_krw: number }]),
  );
  const rows = (keywordRes.data || []) as unknown as KeywordPlanRow[];
  const groups = new Map<string, KeywordPlanRow[]>();
  for (const row of rows) {
    const list = groups.get(groupKey(row)) || [];
    list.push(row);
    groups.set(groupKey(row), list);
  }

  const decisions: Array<Record<string, unknown>> = [];
  const createdCampaigns: string[] = [];
  const createdCreatives: string[] = [];
  let linkedKeywords = 0;

  for (const groupRows of groups.values()) {
    const first = groupRows[0];
    const budget = budgets.get(first.platform);
    const maxBid = Math.max(...groupRows.map((row) => Number(row.suggested_bid_krw || 0)));
    const ready = integrationReady(first.platform);
    const budgetReady = Boolean(budget && budget.status === 'active' && Number(budget.monthly_budget_krw) > 0 && Number(budget.daily_budget_cap_krw) > 0);
    const bidAllowed = !budget?.max_cpc_krw || maxBid <= Number(budget.max_cpc_krw);
    const eligible = ready && budgetReady && bidAllowed;
    const blockedReason = !ready ? 'integration' : !budgetReady ? 'budget' : !bidAllowed ? 'max_cpc' : null;

    decisions.push({
      run_id: run.id,
      platform: first.platform,
      decision_type: eligible ? 'start_test' : 'no_change',
      target_table: 'search_ad_keyword_plans',
      target_id: first.id,
      before_state: jsonState({ keyword_count: groupRows.length, campaign_name: first.campaign_name }),
      after_state: jsonState({ draft_campaign: eligible ? 'ready' : 'blocked' }),
      reason: eligible
        ? '승인된 검색광고 키워드를 내부 캠페인 드래프트와 text ad 소재로 묶을 수 있습니다.'
        : blockedReason === 'integration'
          ? '채널 API 키 또는 OAuth 구성이 부족해 캠페인 드래프트 생성을 보류합니다.'
          : blockedReason === 'budget'
            ? '채널 예산이 active가 아니거나 일/월 예산이 없어 캠페인 드래프트 생성을 보류합니다.'
            : `그룹 최대 입찰가 ${maxBid.toLocaleString('ko-KR')}원이 Max CPC ${Number(budget?.max_cpc_krw || 0).toLocaleString('ko-KR')}원을 초과합니다.`,
      confidence: eligible ? 0.82 : 0.62,
      expected_impact: jsonState({
        keyword_count: groupRows.length,
        max_bid_krw: maxBid,
        daily_budget_cap_krw: Number(budget?.daily_budget_cap_krw || 0),
      }),
      applied: false,
      blocked_reason: blockedReason,
    });

    if (!apply || !eligible) continue;

    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from('ad_campaigns')
      .insert({
        package_id: first.package_id,
        name: `[${first.platform.toUpperCase()}] ${first.campaign_name}`,
        channel: first.platform,
        status: 'DRAFT',
        objective: 'CONVERSIONS',
        daily_budget_krw: Number(budget?.daily_budget_cap_krw || 0),
        total_spend_krw: 0,
        created_by: 'ad_os',
      })
      .select('id')
      .single();

    if (campaignError || !campaign) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: campaignError?.message || 'campaign insert failed' }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: campaignError?.message || 'campaign insert failed' }, { status: 500 });
    }

    const headline = buildHeadline(first);
    const description = buildDescription(groupRows);
    const { data: creative, error: creativeError } = await supabaseAdmin
      .from('ad_creatives')
      .insert({
        product_id: first.package_id,
        campaign_id: campaign.id,
        creative_type: 'text_ad',
        channel: first.platform,
        variant_index: 1,
        hook_type: first.tier === 'longtail' ? 'departure' : 'destination',
        tone: 'informative',
        key_selling_point: first.keyword_text,
        target_segment: 'middle_age',
        headline,
        primary_text: description,
        description,
        body: description,
        keywords: groupRows.map((row) => row.keyword_text),
        ad_copies: {
          headlines: Array.from(new Set([headline, ...groupRows.map((row) => row.keyword_text)])).slice(0, 15),
          descriptions: [description],
          final_url: first.utm_url,
          ad_group_name: first.ad_group_name,
          match_types: groupRows.map((row) => ({ keyword: row.keyword_text, match_type: row.match_type })),
        },
        utm_params: { final_url: first.utm_url, landing_url: first.landing_url, source: first.platform, medium: 'cpc' },
        status: 'review',
      })
      .select('id')
      .single();

    if (creativeError || !creative) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: creativeError?.message || 'creative insert failed' }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: creativeError?.message || 'creative insert failed' }, { status: 500 });
    }

    const keywordIds = groupRows.map((row) => row.id);
    const { error: updateError } = await supabaseAdmin
      .from('search_ad_keyword_plans')
      .update({
        ad_campaign_id: campaign.id,
        ad_creative_id: creative.id,
        draft_published_at: new Date().toISOString(),
        autopilot_status: 'testing',
        last_decision_at: new Date().toISOString(),
        decision_reason: 'Internal campaign draft created by Ad OS guarded publisher.',
        updated_at: new Date().toISOString(),
      })
      .in('id', keywordIds);

    if (updateError) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: updateError.message }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
    }

    createdCampaigns.push(campaign.id);
    createdCreatives.push(creative.id);
    linkedKeywords += keywordIds.length;
  }

  if (decisions.length > 0) {
    await supabaseAdmin.from('ad_os_decision_logs').insert(decisions.map((decision) => ({
      ...decision,
      applied: apply && decision.decision_type === 'start_test',
    })));
  }

  const summary = {
    checked_keywords: rows.length,
    checked_groups: groups.size,
    eligible_groups: decisions.filter((decision) => decision.decision_type === 'start_test').length,
    blocked_groups: decisions.filter((decision) => decision.decision_type !== 'start_test').length,
    created_campaigns: createdCampaigns.length,
    created_creatives: createdCreatives.length,
    linked_keywords: linkedKeywords,
    applied: createdCampaigns.length > 0,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, decisions: decisions.slice(0, 30) });
});
