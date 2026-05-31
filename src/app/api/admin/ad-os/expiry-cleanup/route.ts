import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type ExpiredPackage = {
  id: string;
  title: string | null;
  destination: string | null;
  ticketing_deadline: string | null;
  status: string | null;
};

const EXPIRABLE_STATUSES = ['candidate', 'approved', 'testing', 'active', 'winning', 'scaled'];

function todayKst(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
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
  const limit = Math.min(Math.max(Number(body.limit || 20), 1), 100);
  const today = todayKst();

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'expiry_cleanup',
      mode,
      status: 'running',
      summary: { apply, today, limit },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || '만료 정리 실행 로그 생성 실패' }, { status: 500 });
  }

  const { data: packages, error: pkgError } = await supabaseAdmin
    .from('travel_packages')
    .select('id,title,destination,ticketing_deadline,status')
    .not('ticketing_deadline', 'is', null)
    .lt('ticketing_deadline', today)
    .in('status', ['active', 'approved'])
    .order('ticketing_deadline', { ascending: true })
    .limit(limit);

  if (pkgError) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: pkgError.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: pkgError.message }, { status: 500 });
  }

  const expiredPackages = (packages || []) as ExpiredPackage[];
  const packageIds = expiredPackages.map((pkg) => pkg.id);
  const decisions: Array<Record<string, unknown>> = [];

  const [keywordRes, creativeRes] = packageIds.length
    ? await Promise.all([
        supabaseAdmin
          .from('search_ad_keyword_plans')
          .select('id, package_id, platform, keyword_text, autopilot_status, plan_status')
          .in('package_id', packageIds)
          .in('autopilot_status', EXPIRABLE_STATUSES)
          .limit(500),
        supabaseAdmin
          .from('content_creatives')
          .select('id, product_id, slug, seo_title, status, landing_enabled')
          .in('product_id', packageIds)
          .eq('channel', 'naver_blog')
          .limit(500),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  const firstError = keywordRes.error || creativeRes.error;
  if (firstError) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: firstError.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });
  }

  const packageById = new Map(expiredPackages.map((pkg) => [pkg.id, pkg]));
  for (const keyword of keywordRes.data || []) {
    const pkg = packageById.get(String(keyword.package_id));
    decisions.push({
      run_id: run.id,
      platform: keyword.platform,
      decision_type: 'expire',
      target_table: 'search_ad_keyword_plans',
      target_id: String(keyword.id),
      before_state: jsonState({ autopilot_status: keyword.autopilot_status, plan_status: keyword.plan_status }),
      after_state: jsonState({ autopilot_status: 'expired', plan_status: 'archived' }),
      reason: `발권기한(${pkg?.ticketing_deadline || '-'})이 지난 상품의 검색광고 키워드 후보/집행은 중지해야 합니다.`,
      confidence: 0.94,
      expected_impact: jsonState({ external_spend_risk: 'prevented', package_id: keyword.package_id }),
      applied: false,
    });
  }

  const creativeIds = (creativeRes.data || []).map((creative) => String(creative.id));
  const mappingRes = creativeIds.length
    ? await supabaseAdmin
        .from('ad_landing_mappings')
        .select('id, content_creative_id, platform, keyword, operational_status, active')
        .in('content_creative_id', creativeIds)
        .in('operational_status', EXPIRABLE_STATUSES)
        .limit(500)
    : { data: [], error: null };

  if (mappingRes.error) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: mappingRes.error.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: mappingRes.error.message }, { status: 500 });
  }

  const creativeById = new Map((creativeRes.data || []).map((creative) => [String(creative.id), creative]));
  for (const mapping of mappingRes.data || []) {
    const creative = creativeById.get(String(mapping.content_creative_id));
    const pkg = creative?.product_id ? packageById.get(String(creative.product_id)) : null;
    decisions.push({
      run_id: run.id,
      platform: mapping.platform,
      decision_type: 'expire',
      target_table: 'ad_landing_mappings',
      target_id: String(mapping.id),
      before_state: jsonState({ operational_status: mapping.operational_status, active: mapping.active }),
      after_state: jsonState({ operational_status: 'expired', active: false }),
      reason: `발권기한(${pkg?.ticketing_deadline || '-'})이 지난 상품에 연결된 블로그 광고 매핑입니다. 집행/CTA를 중지 후보로 올립니다.`,
      confidence: 0.91,
      expected_impact: jsonState({ external_spend_risk: 'prevented', content_creative_id: mapping.content_creative_id }),
      applied: false,
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

  if (apply && decisions.length > 0) {
    const keywordIds = decisions.filter((d) => d.target_table === 'search_ad_keyword_plans').map((d) => String(d.target_id));
    const mappingIds = decisions.filter((d) => d.target_table === 'ad_landing_mappings').map((d) => String(d.target_id));
    if (keywordIds.length) {
      await supabaseAdmin
        .from('search_ad_keyword_plans')
        .update({
          autopilot_status: 'expired',
          plan_status: 'archived',
          last_decision_at: new Date().toISOString(),
          decision_reason: 'Expired by Ad OS expiry cleanup.',
          updated_at: new Date().toISOString(),
        })
        .in('id', keywordIds);
    }
    if (mappingIds.length) {
      await supabaseAdmin
        .from('ad_landing_mappings')
        .update({
          operational_status: 'expired',
          active: false,
          last_decision_at: new Date().toISOString(),
          decision_reason: 'Expired by Ad OS expiry cleanup.',
        })
        .in('id', mappingIds);
    }
    await supabaseAdmin
      .from('ad_os_decision_logs')
      .update({ applied: true })
      .eq('run_id', run.id);
  }

  const summary = {
    expired_packages: expiredPackages.length,
    keyword_targets: decisions.filter((d) => d.target_table === 'search_ad_keyword_plans').length,
    mapping_targets: decisions.filter((d) => d.target_table === 'ad_landing_mappings').length,
    decisions: decisions.length,
    applied: apply,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, decisions: decisions.slice(0, 30) });
});
