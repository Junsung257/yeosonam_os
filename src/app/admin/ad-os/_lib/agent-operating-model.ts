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

export function aiAdTeamStatusLabel(status: AiAdTeamStatus): string {
  if (status === 'ready') return '정상';
  if (status === 'attention') return '확인 필요';
  return '막힘';
}

export function priorityLabel(priority: RoasDiagnostic['hypotheses'][number]['priority']): string {
  if (priority === 'high') return '높음';
  if (priority === 'medium') return '중간';
  return '낮음';
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
      label: '기획 담당',
      status: toneStatus(keywordCandidates > 0, budgetActive, completionScore > 0),
      inputSummary: '상품, 키워드 후보, 채널 예산, 완료 점검 근거를 봅니다.',
      evidence: [
        `키워드 후보 ${keywordCandidates.toLocaleString('ko-KR')}개`,
        `활성 예산 ${summary.channel_budgets.filter((budget) => budget.status === 'active').length}개`,
        `준비 점수 ${completionScore}%`,
      ],
      decision: keywordCandidates > 0 ? '기획 초안 있음' : '기획 입력 부족',
      nextAction: keywordCandidates > 0 ? '예산 한도 안의 키워드/캠페인 초안만 승인하세요.' : '상품, SEO, 검색어 신호로 키워드 후보를 먼저 만드세요.',
      needsHumanApproval: keywordCandidates > 0,
    },
    {
      id: 'performance_analyst',
      label: '성과 분석 담당',
      status: toneStatus(Boolean(learning), learningEvents > 0 || searchTerms > 0, completionScore >= 60),
      inputSummary: '학습 이벤트, 검색어 후보, ROAS/CPA/CTA/전환 지표를 봅니다.',
      evidence: [
        `학습 이벤트 ${learningEvents.toLocaleString('ko-KR')}개`,
        `검색어 샘플 ${searchTerms.toLocaleString('ko-KR')}개`,
        `ROAS ${roas || 0}% / CPA ${cpa ? `${cpa.toLocaleString('ko-KR')}원` : '-'}`,
      ],
      decision: learningEvents > 0 || searchTerms > 0 ? '진단 근거 있음' : '진단 근거 부족',
      nextAction: '광고비를 바꾸기 전에 학습 수집, 검색어 확장, 예산 페이싱을 먼저 실행하세요.',
      needsHumanApproval: true,
    },
    {
      id: 'copywriter',
      label: '소재/카피 담당',
      status: toneStatus(creativeVariants > 0 || draftCampaigns > 0, keywordCandidates > 0),
      inputSummary: '소재 후보, 캠페인 초안, 상품 시나리오, 키워드 의도를 봅니다.',
      evidence: [
        `소재 후보 ${creativeVariants.toLocaleString('ko-KR')}개`,
        `캠페인 초안 ${draftCampaigns.toLocaleString('ko-KR')}개`,
        `상품 시나리오 ${num(summary.samples.product_scenarios?.length).toLocaleString('ko-KR')}개`,
      ],
      decision: creativeVariants > 0 || draftCampaigns > 0 ? '소재 초안 있음' : '소재 초안 필요',
      nextAction: '유료 채널에 내보내기 전에 카피 변형을 만들거나 검수하세요.',
      needsHumanApproval: creativeVariants > 0 || draftCampaigns > 0,
    },
    {
      id: 'reporter',
      label: '보고 담당',
      status: toneStatus(reports > 0 || auditExports > 0, completionScore > 0),
      inputSummary: '광고주 리포트, 감사 파일, 완료 점검, 이슈, 다음 액션을 정리합니다.',
      evidence: [
        `준비/초안 리포트 ${reports.toLocaleString('ko-KR')}개`,
        `감사 파일 ${auditExports.toLocaleString('ko-KR')}개`,
        summary.enterprise_layer?.completion_audit?.status ? `완료 점검 ${summary.enterprise_layer.completion_audit.status}` : '완료 점검 없음',
      ],
      decision: reports > 0 || auditExports > 0 ? '보고 패키지 있음' : '보고 패키지 부족',
      nextAction: reports > 0 || auditExports > 0 ? '근거를 광고주용 주간 리포트로 묶으세요.' : '학습 근거를 갱신한 뒤 광고주 리포트와 감사 파일을 만드세요.',
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
      reason: '검색어 근거가 아직 연결되지 않았습니다.',
      evidence: 'Ad OS 요약에 검색어 샘플이 0개입니다.',
      immediateAction: '광고비를 늘리기 전에 학습 수집과 검색어 확장을 실행하세요.',
      holdReason: '성과 검색어와 낭비 검색어를 안전하게 구분할 수 없습니다.',
      needsHumanApproval: false,
    });
  }

  if (input.roas > 0 && input.roas < 300) {
    hypotheses.push({
      id: 'low-roas',
      priority: 'high',
      reason: 'ROAS가 운영 기준 300%보다 낮습니다.',
      evidence: `현재 ROAS 근거는 ${input.roas}%입니다.`,
      immediateAction: '증액 전에 CPA, 마진, 랜딩 CTA, 예산 페이싱을 확인하세요.',
      holdReason: '마진 근거가 부족한 상태에서 증액하면 손실이 커질 수 있습니다.',
      needsHumanApproval: true,
    });
  }

  if (input.ctrProxy > 0 && input.ctrProxy < 2) {
    hypotheses.push({
      id: 'weak-click-intent',
      priority: 'medium',
      reason: 'CTA/클릭 의도 신호가 약합니다.',
      evidence: `CTA율 프록시는 ${input.ctrProxy}%입니다.`,
      immediateAction: '소재/카피 담당이 새 훅을 만들고 랜딩 메시지를 키워드 의도에 맞추세요.',
      holdReason: '소재 피로도나 의도 불일치가 광고비 낭비를 만들 수 있습니다.',
      needsHumanApproval: true,
    });
  }

  if (input.conversionRate === 0 && input.learningEvents > 0) {
    hypotheses.push({
      id: 'conversion-gap',
      priority: 'medium',
      reason: '학습 이벤트는 있지만 전환 근거가 없습니다.',
      evidence: `학습 이벤트 ${input.learningEvents}개, 전환율 0%입니다.`,
      immediateAction: '예약 귀속, 랜딩 CTA 추적, 전환 업로드 품질을 점검하세요.',
      holdReason: '트래픽 품질 문제인지 추적 실패인지 구분할 수 없습니다.',
      needsHumanApproval: false,
    });
  }

  if (!input.budgetActive) {
    hypotheses.push({
      id: 'budget-not-active',
      priority: 'low',
      reason: '활성화된 검색광고 예산이 없습니다.',
      evidence: '채널 예산이 비활성 상태이거나 0원으로 제한되어 있습니다.',
      immediateAction: '예산 가드레일을 설정할 때까지 진단만 읽기 모드로 유지하세요.',
      holdReason: '예산 가드레일 없이는 외부 광고 집행을 막아야 합니다.',
      needsHumanApproval: true,
    });
  }

  if (hypotheses.length === 0) {
    hypotheses.push({
      id: 'healthy-monitoring',
      priority: 'low',
      reason: '현재 근거에서는 즉시 막아야 할 ROAS/CPA/CTR/CVR 문제가 없습니다.',
      evidence: `준비 점수 ${input.completionScore}%, ROAS ${input.roas || '-'}%.`,
      immediateAction: '모니터링을 유지하고 다음 학습 수집을 실행하세요.',
      holdReason: '보류 없음. 실집행 가드레일은 유지하세요.',
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
      { label: '캠페인 목적', value: summary.kpis.keyword_candidates > 0 ? '상품/SEO 신호 기반 검색 수요 포착' : '키워드 후보 생성 필요' },
      { label: '예산 안전장치', value: `활성 채널 예산 ${activeBudgets}개` },
      { label: '승인 기준', value: summary.tenant_policy?.require_human_approval === false ? '정책상 사람 승인 선택' : '사람 승인 필요' },
      { label: '학습 상태', value: learning?.next_action || '학습 루프 미연결' },
      { label: '보고 상태', value: report?.next_action || completion?.next_action || '근거 갱신 후 광고주 리포트 생성' },
      { label: '메모리 저장', value: persistedMemory ? `${persistedStatus || '저장됨'} / ${String(persistedMemory.updated_at || '-')}` : '아직 저장된 메모리 없음' },
    ],
    nextTests: [
      '학습 수집과 검색어 확장을 실행한 뒤 추가/제외 키워드를 검수하세요.',
      '예산 증액 전 CTR/CTA가 낮은 구간에 새 카피 훅 1세트를 만드세요.',
      '중요 막힘이 해소된 뒤 광고주 리포트와 감사 파일을 생성하세요.',
    ],
    persistedId: persistedMemory ? String(persistedMemory.id || '') || null : null,
    persistedAt: persistedMemory ? String(persistedMemory.updated_at || '') || null : null,
  };
}
