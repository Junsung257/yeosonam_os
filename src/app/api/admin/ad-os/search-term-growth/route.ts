import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import {
  buildSearchTermGrowthPlan,
  type ExistingKeywordPlanSignal,
  type SearchTermGrowthCandidate,
  type SearchTermGrowthDraft,
  type SearchTermGrowthPackage,
} from '@/lib/ad-os-search-term-growth';
import type { PaidKeywordPlatform } from '@/lib/ad-os-seo-keyword-bridge';

export const dynamic = 'force-dynamic';

type CandidateRow = {
  id: string;
  platform: PaidKeywordPlatform;
  search_term: string | null;
  parent_keyword: string | null;
  action: 'add_keyword' | 'add_negative' | 'review';
  priority: 'high' | 'medium' | 'low' | null;
  impressions: number | null;
  clicks: number | null;
  cost_krw: number | null;
  conversions: number | string | null;
  ctr: number | string | null;
  score: number | string | null;
  reason: string | null;
  source: string | null;
};

type PackageRow = {
  id: string;
  title: string | null;
  destination: string | null;
  short_code: string | null;
};

type ExistingPlanRow = {
  package_id: string;
  platform: PaidKeywordPlatform;
  keyword_text: string | null;
  match_type: 'exact' | 'phrase' | 'broad' | null;
  tier: 'core' | 'mid' | 'longtail' | 'negative' | null;
};

function appUrl(): string {
  return String(
    getSecret('NEXT_PUBLIC_APP_URL') ||
      getSecret('NEXT_PUBLIC_BASE_URL') ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'https://yeosonam.com',
  ).replace(/\/$/, '');
}

function slugPart(value: unknown): string {
  return String(value || 'ad')
    .toLowerCase()
    .replace(/[^a-z0-9\uac00-\ud7a3]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 44) || 'ad';
}

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function toCandidate(row: CandidateRow): SearchTermGrowthCandidate {
  return {
    id: row.id,
    platform: row.platform,
    searchTerm: row.search_term || '',
    parentKeyword: row.parent_keyword,
    action: row.action,
    priority: row.priority,
    impressions: Math.max(0, Number(row.impressions || 0)),
    clicks: Math.max(0, Number(row.clicks || 0)),
    costKrw: Math.max(0, Number(row.cost_krw || 0)),
    conversions: Math.max(0, Number(row.conversions || 0)),
    ctr: row.ctr == null ? null : Number(row.ctr),
    score: Math.max(0, Number(row.score || 0)),
    reason: row.reason,
    source: row.source,
  };
}

function packageSignal(row: PackageRow): SearchTermGrowthPackage {
  return {
    id: row.id,
    title: row.title,
    destination: row.destination,
    shortCode: row.short_code,
  };
}

function existingSignal(row: ExistingPlanRow): ExistingKeywordPlanSignal {
  return {
    packageId: row.package_id,
    platform: row.platform,
    keywordText: row.keyword_text || '',
    matchType: row.match_type || 'exact',
    tier: row.tier,
  };
}

function landingUrl(packageId: string): string {
  return `${appUrl()}/packages/${packageId}`;
}

function utmUrl(draft: SearchTermGrowthDraft): string {
  const url = new URL(landingUrl(draft.packageId));
  url.searchParams.set('utm_source', draft.platform);
  url.searchParams.set('utm_medium', 'search_ad');
  url.searchParams.set('utm_campaign', `search_term_growth_${draft.packageId.slice(0, 8)}`);
  url.searchParams.set('utm_term', draft.keyword);
  return url.toString();
}

function keywordPlanRow(draft: SearchTermGrowthDraft, packageById: Map<string, SearchTermGrowthPackage>) {
  const pkg = packageById.get(draft.packageId);
  const campaignSlug = `stg_${slugPart(pkg?.destination || pkg?.shortCode || draft.packageId.slice(0, 8))}_${draft.packageId.slice(0, 8)}`;
  return {
    package_id: draft.packageId,
    platform: draft.platform,
    plan_status: 'draft',
    autopilot_status: draft.tier === 'negative' ? 'negative' : 'candidate',
    automation_level: 1,
    campaign_name: `YSN_STG_${slugPart(pkg?.destination || pkg?.title || draft.packageId)}_${draft.packageId.slice(0, 8)}`,
    campaign_slug: campaignSlug,
    ad_group_name: `${campaignSlug}_${draft.intent}`.slice(0, 80),
    tier: draft.tier,
    match_type: draft.matchType,
    keyword_text: draft.keyword,
    source: 'search_term_growth',
    suggested_bid_krw: draft.suggestedBidKrw,
    daily_budget_share_pct: draft.tier === 'negative' ? 0 : Math.min(1.5, Math.max(0.15, draft.score / 800)),
    monthly_search_volume: null,
    competition_level: null,
    landing_url: landingUrl(draft.packageId),
    utm_url: utmUrl(draft),
    rationale: draft.reason,
    quality_flags: {
      ...draft.evidence,
      search_term_growth: true,
      source_candidate_id: draft.candidateId,
      family_key: draft.familyKey,
      score: draft.score,
      intent: draft.intent,
      external_spend_krw: 0,
    },
    intent_cluster: draft.intent,
    opportunity_score: draft.score,
    max_cpc_krw: draft.maxCpcGuardKrw,
    decision_reason: draft.reason,
  };
}

function clusterRow(draft: SearchTermGrowthDraft, packageById: Map<string, SearchTermGrowthPackage>) {
  const pkg = packageById.get(draft.packageId);
  return {
    product_id: draft.packageId,
    platform: draft.platform,
    cluster_key: `${slugPart(pkg?.destination || pkg?.title || draft.packageId)}:${draft.familyKey}`,
    keyword_text: draft.keyword,
    match_type: draft.matchType,
    tier: draft.tier,
    intent: draft.intent,
    source: 'search_term_growth',
    status: draft.tier === 'negative' ? 'negative' : 'candidate',
    score: draft.score,
    suggested_bid_krw: draft.suggestedBidKrw,
    max_cpc_guard_krw: draft.maxCpcGuardKrw,
    landing_strategy: 'product_landing',
    negative_risk: draft.tier === 'negative',
    duplicate_cluster: false,
    rationale: draft.reason,
    evidence: draft.evidence,
  };
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ ok: false, error: 'Service unavailable' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const limit = Math.min(Math.max(Number(body.limit || 100), 10), 300);
  const minKeywordScore = Math.max(0, Number(body.min_keyword_score || 45));
  const minNegativeScore = Math.max(0, Number(body.min_negative_score || 35));
  const platforms = Array.isArray(body.platforms)
    ? body.platforms.filter((platform: unknown): platform is PaidKeywordPlatform => platform === 'naver' || platform === 'google')
    : ['naver', 'google'] as PaidKeywordPlatform[];

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'candidate_generation',
      mode: apply ? 'guarded' : 'dry_run',
      platform: null,
      status: 'running',
      summary: {
        source: 'search_term_growth',
        apply,
        limit,
        min_keyword_score: minKeywordScore,
        min_negative_score: minNegativeScore,
        external_spend_krw: 0,
      },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return apiResponse(
      { ok: false, error: sanitizeDbError(runError, 'Search term growth run create failed') },
      { status: 500 },
    );
  }

  try {
    const [candidateRes, packageRes, existingRes, budgetRes] = await Promise.all([
      supabaseAdmin
        .from('ad_os_search_term_candidates')
        .select('id,platform,search_term,parent_keyword,action,priority,impressions,clicks,cost_krw,conversions,ctr,score,reason,source')
        .in('platform', platforms)
        .in('action', ['add_keyword', 'add_negative'])
        .in('status', ['candidate', 'approved'])
        .order('score', { ascending: false })
        .limit(limit * 3),
      supabaseAdmin
        .from('travel_packages')
        .select('id,title,destination,short_code')
        .in('status', ['active', 'approved', 'confirmed', 'published'])
        .limit(1000),
      supabaseAdmin
        .from('search_ad_keyword_plans')
        .select('package_id,platform,keyword_text,match_type,tier')
        .in('platform', platforms)
        .limit(5000),
      supabaseAdmin
        .from('ad_os_channel_budgets')
        .select('platform,max_cpc_krw')
        .in('platform', platforms),
    ]);

    const firstError = candidateRes.error || packageRes.error || existingRes.error || budgetRes.error;
    if (firstError) throw firstError;

    const packages = ((packageRes.data || []) as PackageRow[]).map(packageSignal);
    const packageById = new Map(packages.map((pkg) => [pkg.id, pkg]));
    const existingPlans = ((existingRes.data || []) as ExistingPlanRow[]).map(existingSignal);
    const maxCpcByPlatform = Object.fromEntries(
      ((budgetRes.data || []) as Array<{ platform: PaidKeywordPlatform; max_cpc_krw: number | null }>)
        .map((row) => [row.platform, Number(row.max_cpc_krw || 1200)]),
    ) as Partial<Record<PaidKeywordPlatform, number>>;

    const plan = buildSearchTermGrowthPlan(
      ((candidateRes.data || []) as CandidateRow[]).map(toCandidate),
      {
        packages,
        existingPlans,
        maxCpcByPlatform,
        minKeywordScore,
        minNegativeScore,
        limit,
      },
    );
    const drafts = [...plan.keywordDrafts, ...plan.negativeDrafts];

    let insertedKeywordPlans = 0;
    let insertedClusters = 0;
    let insertedChangeRequests = 0;
    let updatedCandidates = 0;
    const insertedPlanRows: Array<{ id: string; platform: PaidKeywordPlatform; keyword_text: string; match_type: string; tier: string }> = [];

    if (apply && drafts.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('search_ad_keyword_plans')
        .upsert(drafts.map((draft) => keywordPlanRow(draft, packageById)), {
          onConflict: 'package_id,platform,keyword_text,match_type',
          ignoreDuplicates: false,
        })
        .select('id,platform,keyword_text,match_type,tier');
      if (error) throw error;
      insertedPlanRows.push(...((data || []) as typeof insertedPlanRows));
      insertedKeywordPlans = data?.length || 0;

      const { data: clusterData, error: clusterError } = await supabaseAdmin
        .from('ad_os_keyword_clusters')
        .upsert(drafts.map((draft) => clusterRow(draft, packageById)), {
          onConflict: 'platform,product_id,keyword_text,match_type',
          ignoreDuplicates: false,
        })
        .select('id');
      if (clusterError) throw clusterError;
      insertedClusters = clusterData?.length || 0;

      const draftByKey = new Map(
        drafts.map((draft) => [`${draft.platform}::${draft.keyword}::${draft.matchType}`, draft]),
      );
      const changeRequests = insertedPlanRows.map((row) => {
        const draft = draftByKey.get(`${row.platform}::${row.keyword_text}::${row.match_type}`);
        return {
          run_id: run.id,
          platform: row.platform,
          automation_level: draft?.tier === 'negative' ? 2 : 1,
          request_type: draft?.tier === 'negative' ? 'create_negative_keyword' : 'create_keyword',
          target_table: 'search_ad_keyword_plans',
          target_id: row.id,
          status: 'proposed',
          title: draft?.tier === 'negative'
            ? `Negative draft from search term: ${row.keyword_text}`
            : `Keyword draft from search term: ${row.keyword_text}`,
          reason: draft?.reason || 'Search term growth candidate requires approval before external execution.',
          risk_level: draft?.tier === 'negative' ? 'medium' : 'low',
          expected_impact: toJson({
            ...draft?.evidence,
            suggested_bid_krw: draft?.suggestedBidKrw || 0,
            max_cpc_krw: draft?.maxCpcGuardKrw || 0,
            external_spend_krw: 0,
          }),
          proposed_change: toJson({
            keyword_plan_id: row.id,
            keyword_text: row.keyword_text,
            match_type: row.match_type,
            tier: row.tier,
            action: draft?.action,
          }),
          rollback_payload: toJson({ plan_status: 'draft', autopilot_status: draft?.tier === 'negative' ? 'negative' : 'candidate' }),
          approval_required: true,
        };
      });
      if (changeRequests.length > 0) {
        const { data: changeData, error: changeError } = await supabaseAdmin
          .from('ad_os_change_requests')
          .insert(changeRequests)
          .select('id');
        if (changeError) throw changeError;
        insertedChangeRequests = changeData?.length || 0;
      }

      const candidateIds = Array.from(new Set(drafts.map((draft) => draft.candidateId)));
      if (candidateIds.length > 0) {
        const { data: updated, error: updateError } = await supabaseAdmin
          .from('ad_os_search_term_candidates')
          .update({ status: 'applied', updated_at: new Date().toISOString() })
          .in('id', candidateIds)
          .select('id');
        if (updateError) throw updateError;
        updatedCandidates = updated?.length || 0;
      }
    }

    const summary = {
      ...plan.summary,
      source: 'search_term_growth',
      apply,
      inserted_keyword_plans: insertedKeywordPlans,
      inserted_clusters: insertedClusters,
      inserted_change_requests: insertedChangeRequests,
      updated_candidates: updatedCandidates,
      candidates: drafts.length,
    };

    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'completed', finished_at: new Date().toISOString(), summary: toJson(summary) })
      .eq('id', run.id);

    return apiResponse({
      ok: true,
      run_id: run.id,
      summary,
      candidates: drafts.slice(0, 40).map((draft) => ({
        keyword: draft.keyword,
        matchType: draft.matchType,
        tier: draft.tier,
        intent: draft.intent,
        score: draft.score,
        suggestedBidKrw: draft.suggestedBidKrw,
        package_id: draft.packageId,
        platform: draft.platform,
        family_key: draft.familyKey,
      })),
      skipped_sample: plan.skipped.slice(0, 30),
      safety: {
        database_mutation: apply,
        external_api_write: false,
        external_spend_krw: 0,
        approval_required: true,
      },
    });
  } catch (err) {
    const safeError = sanitizeDbError(err, 'Search term growth failed');
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: safeError }] })
      .eq('id', run.id);
    return apiResponse({ ok: false, error: safeError }, { status: 500 });
  }
});
