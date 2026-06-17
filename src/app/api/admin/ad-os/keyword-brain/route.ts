import { NextRequest, NextResponse } from 'next/server';
import { buildEnterpriseKeywordBrain } from '@/lib/ad-os-v19-v25';
import { withAdminGuard } from '@/lib/admin-guard';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function slugPart(value: unknown): string {
  return String(value || 'package')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'package';
}

function appUrl(): string {
  return String(
    getSecret('NEXT_PUBLIC_APP_URL') ||
      getSecret('NEXT_PUBLIC_BASE_URL') ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'https://yeosonam.com',
  ).replace(/\/$/, '');
}

function utmUrl(packageId: string, keyword: string, platform: string): string {
  const url = new URL(`${appUrl()}/packages/${packageId}`);
  url.searchParams.set('utm_source', platform);
  url.searchParams.set('utm_medium', 'search_ad');
  url.searchParams.set('utm_campaign', `ad_os_${packageId.slice(0, 8)}`);
  url.searchParams.set('utm_term', keyword);
  return url.toString();
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 연동이 설정되지 않았습니다.' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const limit = Math.min(Math.max(Number(body.limit || 80), 1), 200);
  const packageId = typeof body.package_id === 'string' ? body.package_id.trim() : '';

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'keyword_brain',
      mode: apply ? 'guarded' : 'dry_run',
      status: 'running',
      summary: { apply, limit, package_id: packageId || null },
    })
    .select('id')
    .single();

  if (runError) return NextResponse.json({ ok: false, error: runError.message }, { status: 500 });

  let packageQuery = supabaseAdmin
    .from('travel_packages')
    .select('id,title,destination,departure_airport,airline,price,ticketing_deadline,commission_fixed_amount,commission_rate,short_code,status,created_at')
    .order('created_at', { ascending: false })
    .limit(1);

  if (packageId) packageQuery = packageQuery.eq('id', packageId);
  else packageQuery = packageQuery.in('status', ['active', 'approved', 'confirmed', 'published']);

  const { data: packages, error: packageError } = await packageQuery;
  const pkg = packages?.[0] as {
    id: string;
    title?: string | null;
    destination?: string | null;
    departure_airport?: string | null;
    airline?: string | null;
    price?: number | null;
    ticketing_deadline?: string | null;
    commission_fixed_amount?: number | null;
    commission_rate?: number | null;
    short_code?: string | null;
  } | undefined;

  if (packageError || !pkg) {
    await supabaseAdmin.from('ad_os_automation_runs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      summary: { apply, error: packageError?.message || 'No eligible package found.' },
    }).eq('id', run.id);
    return NextResponse.json({ ok: false, error: packageError?.message || 'No eligible package found.' }, { status: 404 });
  }

  const [existingRes, termsRes, budgetRes] = await Promise.all([
    supabaseAdmin
      .from('search_ad_keyword_plans')
      .select('keyword_text')
      .eq('package_id', pkg.id)
      .limit(1000),
    supabaseAdmin
      .from('ad_os_search_terms')
      .select('search_term,action,score,status')
      .order('score', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('ad_os_channel_budgets')
      .select('platform,max_cpc_krw')
      .eq('platform', 'naver')
      .maybeSingle(),
  ]);

  const existingKeywords = (existingRes.data || []).map((row: { keyword_text?: string | null }) => row.keyword_text || '');
  const searchTerms = (termsRes.data || []) as Array<{ search_term?: string | null; action?: string | null; score?: number | null; status?: string | null }>;
  const winningSearchTerms = searchTerms
    .filter((row) => row.action === 'add_keyword' && ['candidate', 'approved', 'applied'].includes(row.status || 'candidate'))
    .map((row) => row.search_term || '');
  const wasteSearchTerms = searchTerms
    .filter((row) => row.action === 'add_negative' && ['candidate', 'approved', 'applied'].includes(row.status || 'candidate'))
    .map((row) => row.search_term || '');
  const maxCpcGuardKrw = Number(budgetRes.data?.max_cpc_krw || 500);

  const candidates = buildEnterpriseKeywordBrain({
    product: {
      id: pkg.id,
      title: pkg.title,
      destination: pkg.destination,
      departureAirport: pkg.departure_airport,
      airline: pkg.airline,
      priceKrw: pkg.price,
      ticketDeadline: pkg.ticketing_deadline,
      marginKrw: Number(pkg.commission_fixed_amount || 0),
    },
    winningSearchTerms,
    wasteSearchTerms,
    existingKeywords,
    maxCpcGuardKrw,
    limit,
  });

  let insertedClusters = 0;
  let insertedPlans = 0;
  if (apply && candidates.length > 0) {
    const clusterRows = candidates.map((candidate) => ({
      product_id: pkg.id,
      platform: candidate.platform,
      cluster_key: `${slugPart(pkg.destination || pkg.title)}:${candidate.intent}`,
      keyword_text: candidate.keyword,
      match_type: candidate.matchType,
      tier: candidate.tier,
      intent: candidate.intent,
      source: candidate.source,
      status: candidate.tier === 'negative' ? 'negative' : 'candidate',
      score: candidate.score,
      suggested_bid_krw: candidate.suggestedBidKrw,
      max_cpc_guard_krw: candidate.maxCpcGuardKrw,
      landing_strategy: candidate.landingStrategy,
      negative_risk: candidate.negativeRisk,
      duplicate_cluster: candidate.duplicateCluster,
      rationale: candidate.rationale,
      evidence: candidate.evidence,
    }));
    const { data: clusterData, error: clusterError } = await supabaseAdmin
      .from('ad_os_keyword_clusters')
      .upsert(clusterRows, { onConflict: 'platform,product_id,keyword_text,match_type', ignoreDuplicates: false })
      .select('id');
    if (clusterError) return NextResponse.json({ ok: false, error: clusterError.message }, { status: 500 });
    insertedClusters = clusterData?.length || 0;

    const landingUrl = `${appUrl()}/packages/${pkg.id}`;
    const campaignSlug = `pkg_${slugPart(pkg.destination || pkg.short_code || pkg.id.slice(0, 8))}_${pkg.id.slice(0, 8)}`;
    const planRows = candidates.map((candidate) => ({
      package_id: pkg.id,
      platform: candidate.platform,
      plan_status: 'draft',
      autopilot_status: candidate.tier === 'negative' ? 'negative' : 'candidate',
      automation_level: 1,
      campaign_name: `YSN_${slugPart(pkg.destination || pkg.title)}_${pkg.id.slice(0, 8)}`,
      campaign_slug: campaignSlug,
      ad_group_name: `${campaignSlug}_${candidate.intent}`.slice(0, 80),
      tier: candidate.tier === 'negative' ? 'negative' : candidate.tier,
      match_type: candidate.matchType,
      keyword_text: candidate.keyword,
      source: 'ad_os_keyword_brain',
      suggested_bid_krw: candidate.suggestedBidKrw,
      daily_budget_share_pct: candidate.tier === 'negative' ? 0 : 1,
      monthly_search_volume: null,
      competition_level: null,
      landing_url: landingUrl,
      utm_url: utmUrl(pkg.id, candidate.keyword, candidate.platform),
      rationale: candidate.rationale,
      quality_flags: {
        ...candidate.evidence,
        v19_v25_keyword_brain: true,
        score: candidate.score,
        intent: candidate.intent,
        landing_strategy: candidate.landingStrategy,
        negative_risk: candidate.negativeRisk,
      },
    }));
    const { data: planData, error: planError } = await supabaseAdmin
      .from('search_ad_keyword_plans')
      .upsert(planRows, { onConflict: 'package_id,platform,keyword_text,match_type', ignoreDuplicates: false })
      .select('id');
    if (planError) return NextResponse.json({ ok: false, error: planError.message }, { status: 500 });
    insertedPlans = planData?.length || 0;
  }

  await supabaseAdmin.from('ad_os_automation_runs').update({
    status: 'completed',
    finished_at: new Date().toISOString(),
    summary: {
      apply,
      package_id: pkg.id,
      candidates: candidates.length,
      inserted_clusters: insertedClusters,
      inserted_keyword_plans: insertedPlans,
      external_spend_krw: 0,
    },
  }).eq('id', run.id);

  return NextResponse.json({
    ok: true,
    apply,
    run_id: run.id,
    package: {
      id: pkg.id,
      title: pkg.title,
      destination: pkg.destination,
    },
    summary: {
      candidates: candidates.length,
      inserted_clusters: insertedClusters,
      inserted_keyword_plans: insertedPlans,
      external_spend_krw: 0,
    },
    candidates,
  });
});
