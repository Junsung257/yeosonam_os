import { NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { analyzeSearchTerms, fetchGoogleSearchTerms, type SearchTerm } from '@/lib/search-ads-api';

export const dynamic = 'force-dynamic';

function jsonState(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value));
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

function searchTermScore(term: SearchTerm): number {
  const conversionScore = Number(term.conversions || 0) * 100;
  const clickScore = Number(term.clicks || 0) * 2;
  const wastePenalty = term.conversions > 0 ? 0 : Math.min(Number(term.costKrw || 0) / 100, 80);
  return Math.max(0, Math.round(conversionScore + clickScore - wastePenalty));
}

function learningScore(row: { clicks?: number | null; cta_clicks?: number | null; conversions?: number | null; conversion_value_krw?: number | null }): number {
  return Math.round(Number(row.clicks || 0) + Number(row.cta_clicks || 0) * 5 + Number(row.conversions || 0) * 100 + Number(row.conversion_value_krw || 0) / 10000);
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ ok: false, error: 'Service unavailable' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body.mode === 'guarded' || body.mode === 'full' ? body.mode : 'dry_run';
  const apply = mode !== 'dry_run' && body.apply === true;
  const includeMockSearchTerms = body.include_mock_search_terms === true;
  const since = daysAgo(Math.min(Math.max(Number(body.days || 30), 1), 90));

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'search_term_harvest',
      mode,
      status: 'running',
      summary: { apply, since, includeMockSearchTerms },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return apiResponse({ ok: false, error: sanitizeDbError(runError, 'Learning harvest run create failed') }, { status: 500 });
  }

  const [mappingRes, engagementRes, conversionRes, keywordRes] = await Promise.all([
    supabaseAdmin
      .from('ad_landing_mappings')
      .select('id, platform, keyword, content_creative_id, clicks, cta_clicks, conversions, conversion_value_krw, operational_status')
      .or('clicks.gt.0,cta_clicks.gt.0,conversions.gt.0')
      .limit(500),
    supabaseAdmin
      .from('blog_engagement_logs')
      .select('id, content_creative_id, ad_landing_mapping_id, cta_clicked, max_scroll_depth_pct, time_on_page_seconds, created_at')
      .gte('created_at', since)
      .limit(1000),
    supabaseAdmin
      .from('ad_conversion_logs')
      .select('id, ad_landing_mapping_id, content_creative_id, final_sales_price, net_profit, allocated_ad_spend, first_touch_keyword, attributed_source, created_at')
      .gte('created_at', since)
      .limit(1000),
    supabaseAdmin
      .from('search_ad_keyword_plans')
      .select('id, platform, keyword_text, external_keyword_id, autopilot_status')
      .in('platform', ['google'])
      .not('external_keyword_id', 'is', null)
      .limit(200),
  ]);

  const firstError = mappingRes.error || engagementRes.error || conversionRes.error || keywordRes.error;
  if (firstError) {
    const safeError = sanitizeDbError(firstError);
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: safeError }] })
      .eq('id', run.id);
    return apiResponse({ ok: false, error: safeError }, { status: 500 });
  }

  const learningEvents: Array<Record<string, unknown>> = [];
  const searchTermCandidates: Array<Record<string, unknown>> = [];
  const decisions: Array<Record<string, unknown>> = [];

  for (const mapping of mappingRes.data || []) {
    const score = learningScore(mapping);
    const signalType = Number(mapping.conversions || 0) > 0 ? 'conversion' : Number(mapping.cta_clicks || 0) > 0 ? 'cta_click' : 'landing_click';
    learningEvents.push({
      source_table: 'ad_landing_mappings',
      source_id: String(mapping.id),
      platform: mapping.platform,
      signal_type: signalType,
      entity_table: 'ad_landing_mappings',
      entity_id: String(mapping.id),
      ad_landing_mapping_id: mapping.id,
      content_creative_id: mapping.content_creative_id,
      keyword_text: mapping.keyword,
      score,
      metrics: jsonState({
        clicks: mapping.clicks || 0,
        cta_clicks: mapping.cta_clicks || 0,
        conversions: mapping.conversions || 0,
        conversion_value_krw: mapping.conversion_value_krw || 0,
      }),
      recommendation: signalType === 'conversion'
        ? '전환이 발생한 매핑입니다. 같은 의도의 키워드와 랜딩을 확장 후보로 올립니다.'
        : signalType === 'cta_click'
          ? 'CTA 반응이 있는 매핑입니다. 문구/랜딩을 유지하고 소액 테스트 후보로 봅니다.'
          : '랜딩 클릭이 있는 매핑입니다. CTA까지 이어지는지 관찰합니다.',
    });
  }

  for (const row of engagementRes.data || []) {
    if (!row.cta_clicked && Number(row.max_scroll_depth_pct || 0) < 70) continue;
    learningEvents.push({
      source_table: 'blog_engagement_logs',
      source_id: String(row.id),
      platform: 'organic',
      signal_type: row.cta_clicked ? 'cta_click' : 'landing_click',
      entity_table: 'content_creatives',
      entity_id: row.content_creative_id ? String(row.content_creative_id) : null,
      ad_landing_mapping_id: row.ad_landing_mapping_id,
      content_creative_id: row.content_creative_id,
      score: Number(row.cta_clicked ? 30 : 10) + Number(row.max_scroll_depth_pct || 0),
      metrics: jsonState({
        cta_clicked: Boolean(row.cta_clicked),
        max_scroll_depth_pct: row.max_scroll_depth_pct || 0,
        time_on_page_seconds: row.time_on_page_seconds || 0,
      }),
      recommendation: row.cta_clicked
        ? '블로그 CTA가 클릭됐습니다. 이 글의 관점/CTA를 광고 랜딩 후보에 반영합니다.'
        : '깊게 읽힌 블로그입니다. CTA 문구 또는 위치 개선 후보입니다.',
    });
  }

  for (const row of conversionRes.data || []) {
    const margin = Number(row.net_profit || 0);
    const source = ['naver', 'google', 'meta', 'kakao', 'organic'].includes(String(row.attributed_source || ''))
      ? String(row.attributed_source)
      : 'organic';
    learningEvents.push({
      source_table: 'ad_conversion_logs',
      source_id: String(row.id),
      platform: source,
      signal_type: margin > 0 ? 'margin_win' : 'conversion',
      entity_table: 'ad_landing_mappings',
      entity_id: row.ad_landing_mapping_id ? String(row.ad_landing_mapping_id) : null,
      ad_landing_mapping_id: row.ad_landing_mapping_id,
      content_creative_id: row.content_creative_id,
      keyword_text: row.first_touch_keyword,
      score: Math.round(Number(row.final_sales_price || 0) / 10000 + Math.max(margin, 0) / 1000),
      metrics: jsonState({
        final_sales_price: row.final_sales_price || 0,
        net_profit: row.net_profit || 0,
        allocated_ad_spend: row.allocated_ad_spend || 0,
      }),
      recommendation: '예약/마진이 발생한 전환입니다. 같은 목적지·의도·CTA 조합을 다음 상품 광고에 우선 반영합니다.',
    });
  }

  if (includeMockSearchTerms || (keywordRes.data || []).length > 0) {
    const parentIds = (keywordRes.data || []).map((row) => String(row.external_keyword_id || row.id));
    const searchTerms = await fetchGoogleSearchTerms(parentIds);
    const recommendations = analyzeSearchTerms(searchTerms);
    for (const recommendation of recommendations) {
      const term = searchTerms.find((row) => row.searchTerm === recommendation.searchTerm);
      if (!term) continue;
      searchTermCandidates.push({
        platform: term.platform,
        search_term: term.searchTerm,
        parent_keyword: term.keywordText,
        action: recommendation.action === 'add_as_keyword' ? 'add_keyword' : recommendation.action === 'add_as_negative' ? 'add_negative' : 'review',
        priority: recommendation.priority,
        impressions: term.impressions,
        clicks: term.clicks,
        cost_krw: term.costKrw,
        conversions: term.conversions,
        ctr: term.ctr,
        score: searchTermScore(term),
        reason: recommendation.reason,
      });
    }
  }

  if (apply) {
    if (learningEvents.length > 0) {
      const { error } = await supabaseAdmin
        .from('ad_os_learning_events')
        .upsert(learningEvents, { onConflict: 'source_table,source_id,signal_type' });
      if (error) {
        const safeError = sanitizeDbError(error);
        await supabaseAdmin
          .from('ad_os_automation_runs')
          .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: safeError }] })
          .eq('id', run.id);
        return apiResponse({ ok: false, error: safeError }, { status: 500 });
      }
    }
    if (searchTermCandidates.length > 0) {
      const { error } = await supabaseAdmin
        .from('ad_os_search_term_candidates')
        .upsert(searchTermCandidates, { onConflict: 'platform,search_term,action' });
      if (error) {
        const safeError = sanitizeDbError(error);
        await supabaseAdmin
          .from('ad_os_automation_runs')
          .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: safeError }] })
          .eq('id', run.id);
        return apiResponse({ ok: false, error: safeError }, { status: 500 });
      }
    }
  }

  const topSignals = learningEvents
    .slice()
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 20);
  for (const signal of topSignals) {
    decisions.push({
      run_id: run.id,
      platform: signal.platform,
      decision_type: 'create_candidate',
      target_table: String(signal.entity_table || signal.source_table),
      target_id: String(signal.entity_id || signal.source_id),
      before_state: jsonState({ source_table: signal.source_table, source_id: signal.source_id }),
      after_state: jsonState({ learning_signal: signal.signal_type, score: signal.score }),
      reason: String(signal.recommendation),
      confidence: Math.min(0.95, 0.55 + Number(signal.score || 0) / 500),
      expected_impact: signal.metrics,
      applied: apply,
    });
  }

  if (decisions.length > 0) {
    await supabaseAdmin.from('ad_os_decision_logs').insert(decisions);
  }

  const summary = {
    learning_events: learningEvents.length,
    search_term_candidates: searchTermCandidates.length,
    add_keyword_candidates: searchTermCandidates.filter((row) => row.action === 'add_keyword').length,
    add_negative_candidates: searchTermCandidates.filter((row) => row.action === 'add_negative').length,
    decisions: decisions.length,
    applied: apply,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return apiResponse({ ok: true, run_id: run.id, summary, signals: topSignals, search_terms: searchTermCandidates.slice(0, 30) });
});
