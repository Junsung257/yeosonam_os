import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import {
  buildPaidKeywordCandidatesFromOrganic,
  type OrganicKeywordSignal,
  type PaidKeywordCandidate,
  type PaidKeywordPlatform,
} from '@/lib/ad-os-seo-keyword-bridge';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type RankRow = {
  slug: string | null;
  query: string | null;
  impressions: number | null;
  clicks: number | null;
  position: number | null;
};

type ContentRow = {
  id: string;
  slug: string | null;
  destination: string | null;
  product_id: string | null;
  seo_title: string | null;
};

type PackageRow = {
  id: string;
  title: string | null;
  destination: string | null;
  short_code: string | null;
};

function daysAgoDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

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
    .replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 44) || 'ad';
}

function normalizeText(value: unknown): string {
  return String(value || '').toLowerCase().replace(/\s+/g, '').trim();
}

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function landingUrl(candidate: PaidKeywordCandidate, packageId: string): string {
  if (candidate.landingStrategy === 'blog_landing' && candidate.slug) {
    return `${appUrl()}/blog/${candidate.slug}`;
  }
  return `${appUrl()}/packages/${packageId}`;
}

function utmUrl(candidate: PaidKeywordCandidate, packageId: string, platform: PaidKeywordPlatform): string {
  const url = new URL(landingUrl(candidate, packageId));
  url.searchParams.set('utm_source', platform);
  url.searchParams.set('utm_medium', 'search_ad');
  url.searchParams.set('utm_campaign', `seo_bridge_${packageId.slice(0, 8)}`);
  url.searchParams.set('utm_term', candidate.keyword);
  return url.toString();
}

function findPackageForSignal(
  signal: { productId: string | null; destination: string | null },
  packages: PackageRow[],
): PackageRow | null {
  if (signal.productId) {
    const direct = packages.find((pkg) => pkg.id === signal.productId);
    if (direct) return direct;
  }
  const destination = normalizeText(signal.destination);
  if (!destination) return null;
  return packages.find((pkg) => {
    const pkgDestination = normalizeText(pkg.destination);
    const pkgTitle = normalizeText(pkg.title);
    return pkgDestination.includes(destination) || destination.includes(pkgDestination) || pkgTitle.includes(destination);
  }) || null;
}

function buildOrganicSignals(rankRows: RankRow[], contents: ContentRow[], performanceBySlug: Map<string, any>): OrganicKeywordSignal[] {
  const contentBySlug = new Map(contents.filter((row) => row.slug).map((row) => [row.slug as string, row]));
  const groups = new Map<string, {
    slug: string;
    query: string;
    impressions: number;
    clicks: number;
    weightedPosition: number;
    positionWeight: number;
  }>();

  for (const row of rankRows) {
    const slug = row.slug?.trim();
    const query = row.query?.trim();
    if (!slug || !query || query === '__page__') continue;
    const key = `${slug}::${query.toLowerCase()}`;
    const current = groups.get(key) || {
      slug,
      query,
      impressions: 0,
      clicks: 0,
      weightedPosition: 0,
      positionWeight: 0,
    };
    const impressions = Math.max(0, row.impressions || 0);
    const positionWeight = Math.max(1, impressions);
    current.impressions += impressions;
    current.clicks += Math.max(0, row.clicks || 0);
    current.weightedPosition += Math.max(1, row.position || 99) * positionWeight;
    current.positionWeight += positionWeight;
    groups.set(key, current);
  }

  return [...groups.values()].map((group) => {
    const content = contentBySlug.get(group.slug);
    const performance = performanceBySlug.get(group.slug);
    return {
      keyword: group.query,
      slug: group.slug,
      destination: content?.destination || null,
      productId: content?.product_id || null,
      impressions: group.impressions,
      clicks: group.clicks,
      avgPosition: group.positionWeight > 0 ? Math.round((group.weightedPosition / group.positionWeight) * 10) / 10 : null,
      conversions: performance?.first_touch_conversions ?? 0,
      revenueKrw: performance?.first_touch_revenue ?? 0,
      profitKrw: performance?.first_touch_profit ?? 0,
    };
  });
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ ok: false, error: 'Service unavailable' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const days = Math.min(Math.max(Number(body.days || 28), 7), 120);
  const limit = Math.min(Math.max(Number(body.limit || 80), 10), 250);
  const minScore = Math.max(0, Number(body.min_score || 35));
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
      summary: { source: 'seo_keyword_bridge', apply, days, limit, min_score: minScore, external_spend_krw: 0 },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return apiResponse({ ok: false, error: sanitizeDbError(runError, 'SEO keyword bridge run create failed') }, { status: 500 });
  }

  try {
    const [rankRes, contentRes, performanceRes, packageRes, budgetRes, existingRes] = await Promise.all([
      supabaseAdmin
        .from('rank_history')
        .select('slug, query, impressions, clicks, position')
        .gte('date', daysAgoDate(days))
        .neq('query', '__page__')
        .limit(limit * 30),
      supabaseAdmin
        .from('content_creatives')
        .select('id, slug, destination, product_id, seo_title')
        .eq('channel', 'naver_blog')
        .not('slug', 'is', null)
        .limit(2000),
      supabaseAdmin
        .from('content_roas_summary')
        .select('slug, first_touch_conversions, first_touch_revenue, first_touch_profit')
        .limit(2000),
      supabaseAdmin
        .from('travel_packages')
        .select('id, title, destination, short_code')
        .in('status', ['active', 'approved', 'confirmed', 'published'])
        .limit(1000),
      supabaseAdmin
        .from('ad_os_channel_budgets')
        .select('platform, max_cpc_krw')
        .in('platform', platforms),
      supabaseAdmin
        .from('search_ad_keyword_plans')
        .select('package_id, platform, keyword_text, match_type')
        .in('platform', platforms)
        .limit(5000),
    ]);

    const firstError = rankRes.error || contentRes.error || packageRes.error || budgetRes.error || existingRes.error;
    if (firstError) throw firstError;

    const performanceBySlug = new Map(
      ((performanceRes.data || []) as any[])
        .filter((row) => row.slug)
        .map((row) => [String(row.slug), row]),
    );
    const packages = (packageRes.data || []) as PackageRow[];
    const maxCpcByPlatform = new Map(
      ((budgetRes.data || []) as Array<{ platform: PaidKeywordPlatform; max_cpc_krw: number | null }>)
        .map((row) => [row.platform, Number(row.max_cpc_krw || 1200)]),
    );
    const existingKeys = new Set(
      ((existingRes.data || []) as Array<{ package_id: string; platform: string; keyword_text: string; match_type: string }>)
        .map((row) => `${row.package_id}::${row.platform}::${row.keyword_text.toLowerCase()}::${row.match_type}`),
    );

    const signals = buildOrganicSignals(
      (rankRes.data || []) as RankRow[],
      (contentRes.data || []) as ContentRow[],
      performanceBySlug,
    );

    const planRows: any[] = [];
    const clusterRows: any[] = [];
    const negativeRows: any[] = [];
    const skipped: Array<{ keyword: string; reason: string }> = [];
    const samples: Array<PaidKeywordCandidate & { package_id: string; platform: PaidKeywordPlatform }> = [];

    for (const platform of platforms) {
      const candidates = buildPaidKeywordCandidatesFromOrganic(signals, {
        platform,
        maxCpcGuardKrw: maxCpcByPlatform.get(platform) || 1200,
        minScore,
        limit,
      });

      for (const candidate of candidates) {
        const signalPackage = findPackageForSignal(candidate, packages);
        if (!signalPackage) {
          skipped.push({ keyword: candidate.keyword, reason: 'no_matching_package' });
          continue;
        }
        const uniqueKey = `${signalPackage.id}::${platform}::${candidate.keyword.toLowerCase()}::${candidate.matchType}`;
        if (existingKeys.has(uniqueKey)) {
          skipped.push({ keyword: candidate.keyword, reason: 'existing_keyword_plan' });
          continue;
        }
        existingKeys.add(uniqueKey);

        const campaignSlug = `seo_${slugPart(signalPackage.destination || signalPackage.short_code || signalPackage.id.slice(0, 8))}_${signalPackage.id.slice(0, 8)}`;
        const row = {
          package_id: signalPackage.id,
          platform,
          plan_status: 'draft',
          autopilot_status: candidate.tier === 'negative' ? 'negative' : 'candidate',
          automation_level: 1,
          campaign_name: `YSN_SEO_${slugPart(signalPackage.destination || signalPackage.title)}_${signalPackage.id.slice(0, 8)}`,
          campaign_slug: campaignSlug,
          ad_group_name: `${campaignSlug}_${candidate.intent}`.slice(0, 80),
          tier: candidate.tier,
          match_type: candidate.matchType,
          keyword_text: candidate.keyword,
          source: 'seo_keyword_bridge',
          suggested_bid_krw: candidate.suggestedBidKrw,
          daily_budget_share_pct: candidate.tier === 'negative' ? 0 : Math.min(2, Math.max(0.2, candidate.score / 500)),
          monthly_search_volume: null,
          competition_level: null,
          landing_url: landingUrl(candidate, signalPackage.id),
          utm_url: utmUrl(candidate, signalPackage.id, platform),
          rationale: candidate.reason,
          quality_flags: {
            ...candidate.evidence,
            seo_keyword_bridge: true,
            score: candidate.score,
            intent: candidate.intent,
            landing_strategy: candidate.landingStrategy,
            max_cpc_guard_krw: candidate.maxCpcGuardKrw,
          },
          intent_cluster: candidate.intent,
          opportunity_score: candidate.score,
          max_cpc_krw: candidate.maxCpcGuardKrw,
          decision_reason: candidate.reason,
        };
        planRows.push(row);
        clusterRows.push({
          product_id: signalPackage.id,
          platform,
          cluster_key: `${slugPart(signalPackage.destination || signalPackage.title)}:${candidate.intent}`,
          keyword_text: candidate.keyword,
          match_type: candidate.matchType,
          tier: candidate.tier,
          intent: candidate.intent,
          source: 'seo_keyword_bridge',
          status: candidate.tier === 'negative' ? 'negative' : 'candidate',
          score: candidate.score,
          suggested_bid_krw: candidate.suggestedBidKrw,
          max_cpc_guard_krw: candidate.maxCpcGuardKrw,
          landing_strategy: candidate.landingStrategy,
          negative_risk: candidate.tier === 'negative',
          duplicate_cluster: false,
          rationale: candidate.reason,
          evidence: candidate.evidence,
        });
        if (candidate.tier === 'negative') {
          negativeRows.push({
            platform,
            search_term: candidate.keyword,
            parent_keyword: null,
            action: 'add_negative',
            priority: candidate.score >= 150 ? 'high' : 'medium',
            impressions: Number(candidate.evidence.impressions || 0),
            clicks: Number(candidate.evidence.clicks || 0),
            cost_krw: 0,
            conversions: 0,
            ctr: 0,
            score: candidate.score,
            reason: candidate.reason,
            source: 'seo_keyword_bridge',
            status: 'candidate',
          });
        }
        samples.push({ ...candidate, package_id: signalPackage.id, platform });
      }
    }

    let insertedPlans = 0;
    let insertedClusters = 0;
    let insertedNegatives = 0;
    if (apply && planRows.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('search_ad_keyword_plans')
        .upsert(planRows, { onConflict: 'package_id,platform,keyword_text,match_type', ignoreDuplicates: false })
        .select('id');
      if (error) throw error;
      insertedPlans = data?.length || 0;
    }
    if (apply && clusterRows.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('ad_os_keyword_clusters')
        .upsert(clusterRows, { onConflict: 'platform,product_id,keyword_text,match_type', ignoreDuplicates: false })
        .select('id');
      if (error) throw error;
      insertedClusters = data?.length || 0;
    }
    if (apply && negativeRows.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('ad_os_search_term_candidates')
        .upsert(negativeRows, { onConflict: 'platform,search_term,action', ignoreDuplicates: false })
        .select('id');
      if (error) throw error;
      insertedNegatives = data?.length || 0;
    }

    const summary = {
      source: 'seo_keyword_bridge',
      apply,
      days,
      organic_signals: signals.length,
      candidate_keyword_plans: planRows.length,
      candidate_clusters: clusterRows.length,
      negative_candidates: negativeRows.length,
      inserted_keyword_plans: insertedPlans,
      inserted_clusters: insertedClusters,
      inserted_negative_candidates: insertedNegatives,
      skipped: skipped.length,
      external_spend_krw: 0,
    };

    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'completed', finished_at: new Date().toISOString(), summary: toJson(summary) })
      .eq('id', run.id);

    return apiResponse({
      ok: true,
      run_id: run.id,
      summary,
      samples: samples.slice(0, 30),
      skipped_sample: skipped.slice(0, 20),
    });
  } catch (err) {
    const safeError = sanitizeDbError(err, 'SEO keyword bridge failed');
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: safeError }] })
      .eq('id', run.id);
    return apiResponse({ ok: false, error: safeError }, { status: 500 });
  }
});
