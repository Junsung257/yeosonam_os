import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { buildSearchTermHarvestRows } from '@/lib/ad-os-v8-v12';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { fetchGoogleSearchTerms } from '@/lib/search-ads-api';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ ok: false, error: 'Service unavailable' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body.mode === 'guarded' || body.mode === 'full' ? body.mode : 'dry_run';
  const apply = mode !== 'dry_run' && body.apply === true;
  const tenantId = typeof body.tenant_id === 'string' ? body.tenant_id : null;

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      tenant_id: tenantId,
      run_type: 'search_term_harvest',
      mode,
      platform: 'google',
      status: 'running',
      summary: { apply, source: 'ad_os_v8_search_term_harvest' },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return apiResponse(
      { ok: false, error: sanitizeDbError(runError, 'Search term harvest run create failed') },
      { status: 500 },
    );
  }

  const { data: keywordRows, error: keywordError } = await supabaseAdmin
    .from('search_ad_keyword_plans')
    .select('id, platform, keyword_text, external_keyword_id')
    .in('platform', ['google'])
    .not('external_keyword_id', 'is', null)
    .limit(200);

  if (keywordError) {
    const safeError = sanitizeDbError(keywordError);
    await supabaseAdmin.from('ad_os_automation_runs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      errors: [{ message: safeError }],
    }).eq('id', run.id);
    return apiResponse({ ok: false, error: safeError }, { status: 500 });
  }

  const externalIds = (keywordRows || [])
    .map((row) => String(row.external_keyword_id || ''))
    .filter(Boolean);
  const searchTerms = await fetchGoogleSearchTerms(externalIds);
  const rows = buildSearchTermHarvestRows(searchTerms).map((row) => ({
    tenant_id: tenantId,
    ...row,
    raw_payload: json(row.raw_payload),
  }));

  let inserted = 0;
  let legacyInserted = 0;
  if (rows.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('ad_os_search_terms')
      .upsert(rows, { onConflict: 'platform,search_term,action' })
      .select('id');
    if (error) {
      const safeError = sanitizeDbError(error);
      await supabaseAdmin.from('ad_os_automation_runs').update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        errors: [{ message: safeError }],
      }).eq('id', run.id);
      return apiResponse({ ok: false, error: safeError }, { status: 500 });
    }
    inserted = data?.length || 0;

    const legacyRows = rows.map((row) => ({
      tenant_id: row.tenant_id,
      platform: row.platform,
      search_term: row.search_term,
      parent_keyword: row.parent_keyword,
      action: row.action,
      priority: row.priority,
      impressions: row.impressions,
      clicks: row.clicks,
      cost_krw: row.cost_krw,
      conversions: row.conversions,
      ctr: row.impressions > 0 ? row.clicks / row.impressions : 0,
      score: row.score,
      reason: row.reason,
      source: 'ad_os_v8_search_term_harvest',
      status: 'candidate',
    }));
    const { data: legacy, error: legacyError } = await supabaseAdmin
      .from('ad_os_search_term_candidates')
      .upsert(legacyRows, { onConflict: 'platform,search_term,action' })
      .select('id');
    if (legacyError) {
      const safeError = sanitizeDbError(legacyError);
      await supabaseAdmin.from('ad_os_automation_runs').update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        errors: [{ message: safeError }],
      }).eq('id', run.id);
      return apiResponse({ ok: false, error: safeError }, { status: 500 });
    }
    legacyInserted = legacy?.length || 0;
  }

  const changeRequests = rows
    .filter((row) => row.action !== 'review')
    .map((row) => ({
      tenant_id: row.tenant_id,
      run_id: run.id,
      platform: row.platform,
      automation_level: 2,
      request_type: row.action === 'add_negative' ? 'create_negative_keyword' : 'create_keyword',
      target_table: 'ad_os_search_terms',
      target_id: `${row.platform}:${row.search_term}:${row.action}`,
      status: apply ? 'proposed' : 'proposed',
      title: row.action === 'add_negative' ? `낭비 검색어 제외: ${row.search_term}` : `승자 검색어 키워드 추가: ${row.search_term}`,
      reason: row.reason,
      risk_level: row.action === 'add_negative' ? 'medium' : 'low',
      expected_impact: json(row),
      proposed_change: json({ keyword_text: row.search_term, action: row.action }),
      rollback_payload: json({ status: 'candidate' }),
      approval_required: true,
    }));
  if (changeRequests.length > 0) {
    const { error } = await supabaseAdmin.from('ad_os_change_requests').insert(changeRequests);
    if (error) {
      const safeError = sanitizeDbError(error);
      await supabaseAdmin.from('ad_os_automation_runs').update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        errors: [{ message: safeError }],
      }).eq('id', run.id);
      return apiResponse({ ok: false, error: safeError }, { status: 500 });
    }
  }

  const summary = {
    fetched_terms: searchTerms.length,
    inserted_terms: inserted,
    legacy_candidates_upserted: legacyInserted,
    add_keyword: rows.filter((row) => row.action === 'add_keyword').length,
    add_negative: rows.filter((row) => row.action === 'add_negative').length,
    review: rows.filter((row) => row.action === 'review').length,
    change_requests: changeRequests.length,
    external_mutations: 0,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return apiResponse({ ok: true, run_id: run.id, summary, samples: rows.slice(0, 20) });
});
