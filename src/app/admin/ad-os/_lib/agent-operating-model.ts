import type { Summary } from './types';

export type AiAdTeamRoleId = 'campaign_planner' | 'performance_analyst' | 'copywriter' | 'reporter';
export type AiAdTeamStatus = 'ready' | 'attention' | 'blocked';

export type AiAdTeamRole = {
  id: AiAdTeamRoleId;
  label: string;
  status: AiAdTeamStatus;
  inputSummary: string;
  evidence: string[];
  decision: string;
  nextAction: string;
  needsHumanApproval: boolean;
};

export type RoasDiagnostic = {
  status: AiAdTeamStatus;
  score: number;
  hypotheses: Array<{
    id: string;
    priority: 'high' | 'medium' | 'low';
    reason: string;
    evidence: string;
    immediateAction: string;
    holdReason: string;
    needsHumanApproval: boolean;
  }>;
};

export type CampaignMemory = {
  status: AiAdTeamStatus;
  score: number;
  facts: Array<{ label: string; value: string }>;
  nextTests: string[];
  persistedId?: string | null;
  persistedAt?: string | null;
};

export type AdOsAgentOperatingModel = {
  teamScore: number;
  overallStatus: AiAdTeamStatus;
  roles: AiAdTeamRole[];
  roasDiagnostic: RoasDiagnostic;
  campaignMemory: CampaignMemory;
};

function num(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusFromScore(score: number): AiAdTeamStatus {
  if (score >= 80) return 'ready';
  if (score > 0) return 'attention';
  return 'blocked';
}

function toneStatus(...conditions: boolean[]): AiAdTeamStatus {
  const passed = conditions.filter(Boolean).length;
  if (passed === conditions.length) return 'ready';
  if (passed > 0) return 'attention';
  return 'blocked';
}

export function buildAdOsAgentOperatingModel(summary: Summary): AdOsAgentOperatingModel {
  const keywordCandidates = num(summary.kpis.keyword_candidates);
  const draftCampaigns = num(summary.kpis.draft_campaigns);
  const learningEvents = num(summary.kpis.learning_events);
  const creativeVariants = num(summary.enterprise_layer?.creative_factory?.variants);
  const reports = num(summary.enterprise_layer?.agency_reporting?.ready_or_draft_reports);
  const auditExports = num(summary.enterprise_layer?.agency_reporting?.ready_audit_exports);
  const completionScore = num(summary.enterprise_layer?.completion_audit?.readiness_score);
  const learning = summary.learning_loop;
  const metrics = learning?.metrics;
  const roas = num(metrics?.roas_pct || metrics?.fact_margin_roas_pct_30d);
  const cpa = num(metrics?.cpa_krw || metrics?.fact_cpa_krw_30d);
  const ctrProxy = num(metrics?.cta_rate_pct);
  const conversionRate = num(metrics?.conversion_rate_pct);
  const searchTerms = num(summary.samples.search_term_candidates?.length);
  const budgetActive = summary.channel_budgets.some((budget) => budget.status === 'active' && budget.monthly_budget_krw > 0);

  const roles: AiAdTeamRole[] = [
    {
      id: 'campaign_planner',
      label: 'Campaign planner',
      status: toneStatus(keywordCandidates > 0, budgetActive, completionScore > 0),
      inputSummary: 'Products, keyword candidates, channel budgets, and completion audit evidence.',
      evidence: [
        `${keywordCandidates.toLocaleString('ko-KR')} keyword candidates`,
        `${summary.channel_budgets.filter((budget) => budget.status === 'active').length} active budgets`,
        `completion score ${completionScore}%`,
      ],
      decision: keywordCandidates > 0 ? 'draft plan available' : 'planning input missing',
      nextAction: keywordCandidates > 0 ? 'Approve only budget-safe keyword and campaign drafts.' : 'Generate keyword candidates from product and SEO/search-term signals.',
      needsHumanApproval: keywordCandidates > 0,
    },
    {
      id: 'performance_analyst',
      label: 'Performance analyst',
      status: toneStatus(Boolean(learning), learningEvents > 0 || searchTerms > 0, completionScore >= 60),
      inputSummary: 'Learning events, search-term candidates, ROAS/CPA/CTA/conversion metrics.',
      evidence: [
        `${learningEvents.toLocaleString('ko-KR')} learning events`,
        `${searchTerms.toLocaleString('ko-KR')} search-term samples`,
        `ROAS ${roas || 0}% / CPA ${cpa ? cpa.toLocaleString('ko-KR') : '-'} KRW`,
      ],
      decision: learningEvents > 0 || searchTerms > 0 ? 'diagnosis evidence available' : 'diagnosis evidence missing',
      nextAction: 'Run learning harvest, search-term growth, and budget pacing before changing spend.',
      needsHumanApproval: true,
    },
    {
      id: 'copywriter',
      label: 'Copywriter',
      status: toneStatus(creativeVariants > 0 || draftCampaigns > 0, keywordCandidates > 0),
      inputSummary: 'Creative variants, draft campaigns, product scenarios, and keyword intent.',
      evidence: [
        `${creativeVariants.toLocaleString('ko-KR')} creative variants`,
        `${draftCampaigns.toLocaleString('ko-KR')} draft campaigns`,
        `${num(summary.samples.product_scenarios?.length).toLocaleString('ko-KR')} scenario samples`,
      ],
      decision: creativeVariants > 0 || draftCampaigns > 0 ? 'creative drafts available' : 'creative drafts needed',
      nextAction: 'Generate or review copy variants before publishing to paid channels.',
      needsHumanApproval: creativeVariants > 0 || draftCampaigns > 0,
    },
    {
      id: 'reporter',
      label: 'Client reporter',
      status: toneStatus(reports > 0 || auditExports > 0, completionScore > 0),
      inputSummary: 'Tenant report, audit export, completion audit, incident response, and next actions.',
      evidence: [
        `${reports.toLocaleString('ko-KR')} ready/draft reports`,
        `${auditExports.toLocaleString('ko-KR')} ready audit exports`,
        summary.enterprise_layer?.completion_audit?.status ? `completion ${summary.enterprise_layer.completion_audit.status}` : 'completion audit missing',
      ],
      decision: reports > 0 || auditExports > 0 ? 'report package available' : 'report package missing',
      nextAction: reports > 0 || auditExports > 0 ? 'Package evidence into advertiser-facing weekly report.' : 'Generate tenant report and audit export after learning evidence refresh.',
      needsHumanApproval: true,
    },
  ];

  const roasDiagnostic = buildRoasDiagnostic({
    roas,
    cpa,
    ctrProxy,
    conversionRate,
    searchTerms,
    learningEvents,
    budgetActive,
    completionScore,
  });
  const campaignMemory = buildCampaignMemory(summary, roles, roasDiagnostic);
  const readyRoles = roles.filter((role) => role.status === 'ready').length;
  const attentionRoles = roles.filter((role) => role.status === 'attention').length;
  const teamScore = Math.max(0, Math.min(100, Math.round((readyRoles / roles.length) * 100 + attentionRoles * 10)));

  return {
    teamScore,
    overallStatus: statusFromScore(teamScore),
    roles,
    roasDiagnostic,
    campaignMemory,
  };
}

function buildRoasDiagnostic(input: {
  roas: number;
  cpa: number;
  ctrProxy: number;
  conversionRate: number;
  searchTerms: number;
  learningEvents: number;
  budgetActive: boolean;
  completionScore: number;
}): RoasDiagnostic {
  const hypotheses: RoasDiagnostic['hypotheses'] = [];

  if (input.searchTerms === 0) {
    hypotheses.push({
      id: 'missing-search-terms',
      priority: 'high',
      reason: 'Search-term evidence is not connected yet.',
      evidence: '0 search-term samples available in the Ad OS summary.',
      immediateAction: 'Run learning harvest and search-term growth before adding spend.',
      holdReason: 'Cannot safely separate winning terms from waste terms.',
      needsHumanApproval: false,
    });
  }

  if (input.roas > 0 && input.roas < 300) {
    hypotheses.push({
      id: 'low-roas',
      priority: 'high',
      reason: 'ROAS is below the 300% operating target.',
      evidence: `Current ROAS evidence is ${input.roas}%.`,
      immediateAction: 'Review CPA, margin, landing CTA, and budget pacing before scaling.',
      holdReason: 'Scaling below target can increase loss if margin facts are incomplete.',
      needsHumanApproval: true,
    });
  }

  if (input.ctrProxy > 0 && input.ctrProxy < 2) {
    hypotheses.push({
      id: 'weak-click-intent',
      priority: 'medium',
      reason: 'CTA/click intent proxy is weak.',
      evidence: `CTA rate proxy is ${input.ctrProxy}%.`,
      immediateAction: 'Ask copywriter role for new hooks and align landing promise to keyword intent.',
      holdReason: 'Creative fatigue or poor intent match may be causing spend waste.',
      needsHumanApproval: true,
    });
  }

  if (input.conversionRate === 0 && input.learningEvents > 0) {
    hypotheses.push({
      id: 'conversion-gap',
      priority: 'medium',
      reason: 'Learning events exist but conversion evidence is missing.',
      evidence: `${input.learningEvents} learning events with 0% conversion rate.`,
      immediateAction: 'Check booking attribution, landing CTA tracking, and conversion upload quality.',
      holdReason: 'Optimization cannot distinguish traffic quality from tracking failure.',
      needsHumanApproval: false,
    });
  }

  if (!input.budgetActive) {
    hypotheses.push({
      id: 'budget-not-active',
      priority: 'low',
      reason: 'No active paid-search budget is available.',
      evidence: 'Channel budgets are not active or capped at zero.',
      immediateAction: 'Keep diagnostics in read-only mode until budget guardrails are configured.',
      holdReason: 'External paid execution must remain blocked without budget guardrails.',
      needsHumanApproval: true,
    });
  }

  if (hypotheses.length === 0) {
    hypotheses.push({
      id: 'healthy-monitoring',
      priority: 'low',
      reason: 'No immediate ROAS/CPA/CTR/CVR blocker detected from available evidence.',
      evidence: `Completion score ${input.completionScore}%, ROAS ${input.roas || '-'}%.`,
      immediateAction: 'Keep monitoring and run the next scheduled learning harvest.',
      holdReason: 'No hold; keep live-write guardrails on.',
      needsHumanApproval: false,
    });
  }

  const high = hypotheses.filter((row) => row.priority === 'high').length;
  const medium = hypotheses.filter((row) => row.priority === 'medium').length;
  const score = Math.max(0, Math.min(100, 100 - high * 30 - medium * 15 - hypotheses.filter((row) => row.priority === 'low').length * 5));

  return {
    status: statusFromScore(score),
    score,
    hypotheses,
  };
}

function buildCampaignMemory(
  summary: Summary,
  roles: AiAdTeamRole[],
  diagnostic: RoasDiagnostic,
): CampaignMemory {
  const completion = summary.enterprise_layer?.completion_audit;
  const learning = summary.learning_loop;
  const report = summary.enterprise_layer?.agency_reporting;
  const activeBudgets = summary.channel_budgets.filter((budget) => budget.status === 'active').length;
  const persistedMemory = summary.samples.campaign_memories?.[0] || null;
  const persistedStatus = persistedMemory ? String(persistedMemory.status || '') : '';
  const score = Math.max(0, Math.min(100, Math.round(
    (completion?.readiness_score || 0) * 0.35 +
    diagnostic.score * 0.25 +
    roles.filter((role) => role.status !== 'blocked').length * 10,
  )));

  return {
    status: statusFromScore(score),
    score,
    facts: [
      { label: 'Campaign purpose', value: summary.kpis.keyword_candidates > 0 ? 'Search demand capture from product/SEO signals' : 'Needs keyword candidate generation' },
      { label: 'Budget guardrails', value: `${activeBudgets} active channel budgets` },
      { label: 'Approval rule', value: summary.tenant_policy?.require_human_approval === false ? 'Human approval optional by policy' : 'Human approval required' },
      { label: 'Learning state', value: learning?.next_action || 'Learning loop not loaded' },
      { label: 'Report state', value: report?.next_action || completion?.next_action || 'Generate tenant report after evidence refresh' },
      { label: 'Memory persistence', value: persistedMemory ? `${persistedStatus || 'saved'} at ${String(persistedMemory.updated_at || '-')}` : 'No saved memory yet' },
    ],
    nextTests: [
      'Run learning harvest and search-term growth, then review positive/negative keyword candidates.',
      'Generate one new hook set for low-CTR/low-CTA segments before increasing budget.',
      'Create tenant report and audit export only after critical completion blockers are clear.',
    ],
    persistedId: persistedMemory ? String(persistedMemory.id || '') || null : null,
    persistedAt: persistedMemory ? String(persistedMemory.updated_at || '') || null : null,
  };
}
