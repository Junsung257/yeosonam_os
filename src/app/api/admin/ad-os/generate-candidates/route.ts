import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { buildAndSaveSearchAdPackagePlan } from '@/lib/search-ads-auto-planner';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type PackageRow = {
  id: string;
  title: string | null;
  destination: string | null;
  ticketing_deadline: string | null;
  created_at: string | null;
};

type DecisionLogRow = {
  run_id: string;
  platform: null;
  decision_type: 'create_candidate';
  target_table: 'travel_packages';
  target_id: string;
  before_state: Record<string, unknown>;
  after_state: Record<string, unknown>;
  reason: string;
  confidence: number;
  expected_impact: Record<string, unknown>;
  applied: boolean;
};

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ ok: false, error: 'Service unavailable' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body.limit || 5), 1), 20);

  const { data: packages, error: packageError } = await supabaseAdmin
    .from('travel_packages')
    .select('id,title,destination,ticketing_deadline,created_at')
    .in('status', ['active', 'approved'])
    .order('created_at', { ascending: false })
    .limit(limit * 4);

  if (packageError) {
    return apiResponse({ ok: false, error: sanitizeDbError(packageError) }, { status: 500 });
  }

  const rows = (packages || []) as PackageRow[];
  const packageIds = rows.map((row) => row.id);
  const existingPackageIds = new Set<string>();

  if (packageIds.length > 0) {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('search_ad_keyword_plans')
      .select('package_id')
      .in('package_id', packageIds);

    if (existingError) {
      return apiResponse({ ok: false, error: sanitizeDbError(existingError) }, { status: 500 });
    }

    for (const row of existing || []) {
      if (row.package_id) existingPackageIds.add(String(row.package_id));
    }
  }

  const targets = rows.filter((row) => !existingPackageIds.has(row.id)).slice(0, limit);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'candidate_generation',
      mode: 'dry_run',
      status: 'running',
      summary: { requested_limit: limit, scanned: rows.length },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return apiResponse(
      { ok: false, error: sanitizeDbError(runError, 'Candidate generation run create failed') },
      { status: 500 },
    );
  }

  const results: Array<{ package_id: string; title: string | null; saved: number; keywords: number; error?: string }> = [];
  const decisions: DecisionLogRow[] = [];

  for (const pkg of targets) {
    try {
      const plan = await buildAndSaveSearchAdPackagePlan(pkg.id);
      results.push({
        package_id: pkg.id,
        title: pkg.title,
        saved: plan.saved,
        keywords: plan.summary.total,
      });
      decisions.push({
        run_id: run.id,
        platform: null,
        decision_type: 'create_candidate',
        target_table: 'travel_packages',
        target_id: pkg.id,
        before_state: { ad_os_keyword_plan: 'missing' },
        after_state: { ad_os_keyword_plan: 'candidate', saved: plan.saved, keywords: plan.summary.total },
        reason: '활성/승인 상품에 검색광고 키워드 플랜이 없어 Ad OS 후보를 자동 생성했습니다.',
        confidence: 0.78,
        expected_impact: { candidate_keywords: plan.summary.total, external_spend: 0 },
        applied: true,
      });
    } catch (error) {
      results.push({
        package_id: pkg.id,
        title: pkg.title,
        saved: 0,
        keywords: 0,
        error: sanitizeDbError(error, 'Candidate generation failed'),
      });
    }
  }

  if (decisions.length > 0) {
    const { error } = await supabaseAdmin.from('ad_os_decision_logs').insert(decisions);
    if (error) {
      const safeError = sanitizeDbError(error);
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: safeError }] })
        .eq('id', run.id);
      return apiResponse({ ok: false, error: safeError }, { status: 500 });
    }
  }

  const summary = {
    scanned: rows.length,
    skipped_existing: existingPackageIds.size,
    targeted: targets.length,
    saved: results.reduce((acc, row) => acc + row.saved, 0),
    keywords: results.reduce((acc, row) => acc + row.keywords, 0),
    failed: results.filter((row) => row.error).length,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({
      status: summary.failed > 0 && summary.saved === 0 ? 'failed' : 'completed',
      finished_at: new Date().toISOString(),
      summary,
      errors: results.filter((row) => row.error).map((row) => ({ package_id: row.package_id, error: row.error })),
    })
    .eq('id', run.id);

  return apiResponse({ ok: true, run_id: run.id, summary, results });
});
