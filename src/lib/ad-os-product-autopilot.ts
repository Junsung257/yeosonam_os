import { deriveAdOsProductScenarios, type AdOsProductScenario } from '@/lib/ad-os-scenario-engine';
import { getAdOsLearningContextForPackage } from '@/lib/ad-os-learning-context';
import {
  buildSearchAdPackagePlan,
  buildAndSaveSearchAdPackagePlan,
  type TravelPackageForSearchAds,
} from '@/lib/search-ads-auto-planner';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { loadCustomerOpenContractForPackage } from '@/lib/product-registration/customer-open-contract';

type AutopilotMode = 'dry_run' | 'guarded' | 'full';

type ProductAutopilotOptions = {
  packageId: string;
  mode?: AutopilotMode;
  apply?: boolean;
  tenantId?: string | null;
  source?: string;
};

export type ProductAutopilotResult = {
  ok: boolean;
  package_id: string;
  mode: AutopilotMode;
  applied: boolean;
  scenarios: {
    generated: number;
    saved: number;
    queued_blog_actions: number;
  };
  search_ads: {
    saved: number;
    keywords: number;
  };
  landing_evolution: {
    queued: number;
  };
  run_id: string | null;
  warnings: string[];
};

type ScenarioRow = {
  id: string;
  scenario_key: string;
  scenario_type: string;
  primary_keyword: string;
  landing_strategy: string;
};

function json(value: unknown): Record<string, unknown> | unknown[] {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function isWriteAllowed(mode: AutopilotMode, apply: boolean): boolean {
  return apply && (mode === 'guarded' || mode === 'full');
}

async function createRun(input: {
  tenantId?: string | null;
  mode: AutopilotMode;
  source: string;
  packageId: string;
}): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      tenant_id: input.tenantId ?? null,
      run_type: 'candidate_generation',
      mode: input.mode,
      status: 'running',
      summary: {
        source: input.source,
        package_id: input.packageId,
        product_autopilot_v: 2,
      },
    })
    .select('id')
    .single();
  if (error) return null;
  return data?.id ?? null;
}

async function finishRun(runId: string | null, result: ProductAutopilotResult): Promise<void> {
  if (!runId || !isSupabaseConfigured) return;
  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({
      status: result.ok ? 'completed' : 'failed',
      finished_at: new Date().toISOString(),
      summary: json(result),
    })
    .eq('id', runId);
}

async function loadPackage(packageId: string): Promise<TravelPackageForSearchAds> {
  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id,title,destination,country,duration,nights,price,departure_airport,airline,product_type,price_tiers,inclusions,itinerary,parsed_data,short_code,tenant_id')
    .eq('id', packageId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? '상품을 찾을 수 없습니다.');
  }

  return data as TravelPackageForSearchAds;
}

function scenarioToDbRow(
  scenario: AdOsProductScenario,
  packageId: string,
  tenantId: string | null | undefined,
  learningContext: Record<string, unknown>,
) {
  return {
    tenant_id: tenantId ?? null,
    package_id: packageId,
    scenario_key: scenario.scenarioKey,
    scenario_type: scenario.scenarioType,
    funnel_stage: scenario.funnelStage,
    target_segment: scenario.targetSegment,
    primary_keyword: scenario.primaryKeyword,
    keyword_variants: scenario.keywordVariants,
    landing_strategy: scenario.landingStrategy,
    recommended_channel: scenario.recommendedChannel,
    status: 'queued',
    priority: scenario.priority,
    opportunity_score: scenario.opportunityScore,
    risk_flags: scenario.riskFlags,
    learning_context: {
      ...scenario.learningContext,
      ...learningContext,
    },
    decision_reason: scenario.decisionReason,
    updated_at: new Date().toISOString(),
  };
}

async function saveScenarios(input: {
  scenarios: AdOsProductScenario[];
  pkg: TravelPackageForSearchAds;
  tenantId?: string | null;
  learningContext: Record<string, unknown>;
}): Promise<ScenarioRow[]> {
  const rows = input.scenarios.map((scenario) =>
    scenarioToDbRow(scenario, input.pkg.id, input.tenantId, input.learningContext),
  );
  if (rows.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('ad_os_product_scenarios')
    .upsert(rows, { onConflict: 'package_id,scenario_key' })
    .select('id,scenario_key,scenario_type,primary_keyword,landing_strategy');

  if (error) throw new Error(`Ad OS 시나리오 저장 실패: ${error.message}`);
  return (data ?? []) as ScenarioRow[];
}

async function enqueueBlogTopics(input: {
  pkg: TravelPackageForSearchAds;
  scenarios: AdOsProductScenario[];
  scenarioRows: ScenarioRow[];
  tenantId?: string | null;
}): Promise<number> {
  const blogScenarios = input.scenarios.filter((scenario) =>
    ['blog_new', 'blog_update', 'hub_page'].includes(scenario.landingStrategy),
  );
  if (blogScenarios.length === 0) return 0;

  const existingRes = await supabaseAdmin
    .from('blog_topic_queue')
    .select('primary_keyword, angle_type, status')
    .eq('product_id', input.pkg.id)
    .in('status', ['queued', 'generating', 'published']);

  const existingKeys = new Set(
    ((existingRes.data ?? []) as Array<{ primary_keyword?: string | null; angle_type?: string | null }>)
      .map((row) => `${row.angle_type || ''}::${row.primary_keyword || ''}`),
  );
  const scenarioIdByKey = new Map(input.scenarioRows.map((row) => [row.scenario_key, row.id]));
  const rows = blogScenarios
    .filter((scenario) => !existingKeys.has(`${scenario.scenarioType}::${scenario.primaryKeyword}`))
    .map((scenario) => ({
      topic: `${input.pkg.destination || '여행'} ${scenario.targetSegment} - ${scenario.primaryKeyword}`,
      source: 'product',
      priority: Math.max(70, scenario.priority),
      destination: input.pkg.destination ?? null,
      angle_type: scenario.scenarioType,
      product_id: input.pkg.id,
      tenant_id: input.tenantId ?? null,
      category: scenario.landingStrategy === 'hub_page' ? 'destination_hub' : 'product_intro',
      primary_keyword: scenario.primaryKeyword,
      keyword_tier: scenario.funnelStage === 'conversion' ? 'longtail' : 'mid',
      competition_level: scenario.funnelStage === 'conversion' ? 'low' : 'medium',
      meta: {
        ad_os_scenario_key: scenario.scenarioKey,
        ad_os_scenario_id: scenarioIdByKey.get(scenario.scenarioKey) ?? null,
        landing_strategy: scenario.landingStrategy,
        keyword_variants: scenario.keywordVariants,
        decision_reason: scenario.decisionReason,
      },
    }));

  if (rows.length === 0) return 0;
  const { data, error } = await supabaseAdmin
    .from('blog_topic_queue')
    .insert(rows)
    .select('id');
  if (error) throw new Error(`블로그 시나리오 큐 저장 실패: ${error.message}`);
  return data?.length ?? 0;
}

async function enqueueLandingEvolution(input: {
  pkg: TravelPackageForSearchAds;
  scenarios: AdOsProductScenario[];
  scenarioRows: ScenarioRow[];
  tenantId?: string | null;
}): Promise<number> {
  const scenarioIdByKey = new Map(input.scenarioRows.map((row) => [row.scenario_key, row.id]));
  const rows = input.scenarios.map((scenario) => ({
    tenant_id: input.tenantId ?? null,
    package_id: input.pkg.id,
    scenario_id: scenarioIdByKey.get(scenario.scenarioKey) ?? null,
    action:
      scenario.landingStrategy === 'card_news'
        ? 'create_card_news'
        : scenario.landingStrategy === 'product_page'
          ? 'replace_cta'
          : scenario.landingStrategy === 'blog_new'
            ? 'create_blog'
            : 'update_blog',
    status: 'candidate',
    priority: scenario.priority,
    reason: scenario.decisionReason,
    evidence: {
      scenario_key: scenario.scenarioKey,
      scenario_type: scenario.scenarioType,
      primary_keyword: scenario.primaryKeyword,
      keyword_variants: scenario.keywordVariants,
    },
    expected_impact: {
      funnel_stage: scenario.funnelStage,
      opportunity_score: scenario.opportunityScore,
      channel: scenario.recommendedChannel,
    },
  }));

  if (rows.length === 0) return 0;
  const { data, error } = await supabaseAdmin
    .from('ad_os_landing_evolution_queue')
    .insert(rows)
    .select('id');
  if (error) throw new Error(`랜딩 진화 큐 저장 실패: ${error.message}`);
  return data?.length ?? 0;
}

async function logScenarioDecisions(input: {
  runId: string | null;
  scenarios: ScenarioRow[];
  apply: boolean;
  tenantId?: string | null;
}): Promise<void> {
  if (!input.runId || input.scenarios.length === 0) return;
  const rows = input.scenarios.map((scenario) => ({
    run_id: input.runId,
    tenant_id: input.tenantId ?? null,
    platform: null,
    decision_type: 'create_candidate',
    target_table: 'ad_os_product_scenarios',
    target_id: scenario.id,
    before_state: {},
    after_state: {
      scenario_type: scenario.scenario_type,
      primary_keyword: scenario.primary_keyword,
      landing_strategy: scenario.landing_strategy,
    },
    reason: 'Product autopilot created a scenario candidate for keyword, landing, and learning orchestration.',
    confidence: 0.74,
    expected_impact: { stage: 'V2 product-to-ad scenario generation' },
    applied: input.apply,
  }));
  await supabaseAdmin.from('ad_os_decision_logs').insert(rows);
}

export async function runAdOsProductAutopilot(options: ProductAutopilotOptions): Promise<ProductAutopilotResult> {
  const mode = options.mode ?? 'dry_run';
  const apply = isWriteAllowed(mode, Boolean(options.apply));
  const warnings: string[] = [];

  if (!isSupabaseConfigured) {
    return {
      ok: false,
      package_id: options.packageId,
      mode,
      applied: false,
      scenarios: { generated: 0, saved: 0, queued_blog_actions: 0 },
      search_ads: { saved: 0, keywords: 0 },
      landing_evolution: { queued: 0 },
      run_id: null,
      warnings: ['Supabase 미설정'],
    };
  }

  const runId = await createRun({
    tenantId: options.tenantId,
    mode,
    source: options.source ?? 'manual',
    packageId: options.packageId,
  });

  const result: ProductAutopilotResult = {
    ok: true,
    package_id: options.packageId,
    mode,
    applied: apply,
    scenarios: { generated: 0, saved: 0, queued_blog_actions: 0 },
    search_ads: { saved: 0, keywords: 0 },
    landing_evolution: { queued: 0 },
    run_id: runId,
    warnings,
  };

  try {
    const pkg = await loadPackage(options.packageId);
    const openContract = await loadCustomerOpenContractForPackage(supabaseAdmin, options.packageId);
    if (!openContract.ok) {
      result.ok = false;
      warnings.push(`CUSTOMER_OPEN_CONTRACT_BLOCKED:${openContract.blockers.slice(0, 5).join('|')}`);
      await finishRun(runId, result);
      return result;
    }
    const tenantId = options.tenantId ?? (pkg as { tenant_id?: string | null }).tenant_id ?? null;
    const learning = await getAdOsLearningContextForPackage(pkg);
    const scenarios = deriveAdOsProductScenarios(pkg);
    result.scenarios.generated = scenarios.length;

    if (apply) {
      const scenarioRows = await saveScenarios({
        scenarios,
        pkg,
        tenantId,
        learningContext: {
          applied: learning.applied,
          summary: learning.summary,
          winning_keywords: learning.winningKeywords,
          negative_terms: learning.negativeTerms,
        },
      });
      result.scenarios.saved = scenarioRows.length;
      result.scenarios.queued_blog_actions = await enqueueBlogTopics({ pkg, scenarios, scenarioRows, tenantId });
      result.landing_evolution.queued = await enqueueLandingEvolution({ pkg, scenarios, scenarioRows, tenantId });
      await logScenarioDecisions({ runId, scenarios: scenarioRows, apply, tenantId });
    }

    if (apply) {
      const searchPlan = await buildAndSaveSearchAdPackagePlan(options.packageId);
      result.search_ads.saved = searchPlan.saved;
      result.search_ads.keywords = searchPlan.summary.total;
    } else {
      const searchPlan = await buildSearchAdPackagePlan(pkg);
      result.search_ads.saved = 0;
      result.search_ads.keywords = searchPlan.summary.total;
    }
  } catch (error) {
    result.ok = false;
    warnings.push(error instanceof Error ? error.message : 'unknown error');
  }

  await finishRun(runId, result);
  return result;
}
