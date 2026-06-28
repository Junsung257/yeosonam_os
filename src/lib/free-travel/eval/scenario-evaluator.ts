import {
  FREE_TRAVEL_P0_IDS,
  FREE_TRAVEL_P1_IDS,
  FREE_TRAVEL_SCENARIO_CASES,
  type FreeTravelScenarioCase,
  type FreeTravelScenarioCategory,
  type FreeTravelScenarioPriority,
} from './scenario-cases';

export interface FreeTravelScenarioCheck {
  name: string;
  passed: boolean;
  message: string;
}

export interface FreeTravelScenarioResult {
  id: number;
  priority: FreeTravelScenarioPriority;
  category: FreeTravelScenarioCategory;
  title: string;
  passed: boolean;
  checks: FreeTravelScenarioCheck[];
}

export interface FreeTravelScenarioSectionScore {
  category: FreeTravelScenarioCategory;
  total: number;
  passed: number;
  score: number;
}

export interface FreeTravelScenarioEvaluation {
  ok: boolean;
  status: 'pass' | 'warn' | 'fail';
  score: number;
  maxScore: 100;
  total: number;
  passed: number;
  failed: number;
  p0Total: number;
  p0Passed: number;
  p0Failures: FreeTravelScenarioResult[];
  priorityCounts: Record<FreeTravelScenarioPriority, number>;
  sectionScores: FreeTravelScenarioSectionScore[];
  results: FreeTravelScenarioResult[];
}

const EXPECTED_IDS = Array.from({ length: 100 }, (_, index) => index + 1);
const EXPECTED_P0 = new Set<number>(FREE_TRAVEL_P0_IDS);
const EXPECTED_P1 = new Set<number>(FREE_TRAVEL_P1_IDS);

function expectedPriority(id: number): FreeTravelScenarioPriority {
  if (EXPECTED_P0.has(id)) return 'P0';
  if (EXPECTED_P1.has(id)) return 'P1';
  return 'P2';
}

function expectedCategory(id: number): FreeTravelScenarioCategory {
  if (id <= 35) return 'search_recommendation_ux';
  if (id <= 70) return 'api_provider_resilience';
  return 'operations_settlement_storage';
}

function includesAny(values: string[], needles: string[]): boolean {
  const text = values.join(' ').toLowerCase();
  return needles.some((needle) => text.includes(needle));
}

function addCheck(checks: FreeTravelScenarioCheck[], name: string, passed: boolean, message: string): void {
  checks.push({ name, passed, message });
}

function evaluateScenario(
  scenario: FreeTravelScenarioCase,
  idCounts: Map<number, number>,
): FreeTravelScenarioResult {
  const checks: FreeTravelScenarioCheck[] = [];
  const expected = scenario.expected;

  addCheck(checks, 'id_range', Number.isInteger(scenario.id) && scenario.id >= 1 && scenario.id <= 100, 'id must be 1..100');
  addCheck(checks, 'id_unique', (idCounts.get(scenario.id) ?? 0) === 1, 'id must be unique');
  addCheck(checks, 'priority_matches_spec', scenario.priority === expectedPriority(scenario.id), 'priority must match SSOT scenario spec');
  addCheck(checks, 'category_matches_spec', scenario.category === expectedCategory(scenario.id), 'category must match scenario range');
  addCheck(checks, 'title_present', scenario.title.trim().length >= 8, 'title must be human-readable');
  addCheck(checks, 'input_present', scenario.input.trim().length > 0, 'input fixture must be present');
  addCheck(checks, 'assertions_present', scenario.assertions.length >= 2, 'scenario must have at least two executable assertions');
  addCheck(checks, 'expected_api_present', expected.api.length > 0, 'scenario must define API expectations');
  addCheck(checks, 'expected_ui_present', expected.ui.length > 0, 'scenario must define UI expectations');
  addCheck(checks, 'expected_persistence_present', expected.persistence.length > 0, 'scenario must define persistence or audit expectations');

  if (scenario.priority === 'P0') {
    addCheck(checks, 'p0_guardrail', expected.api.includes('p0_guardrail'), 'P0 cases must include a hard guardrail');
    addCheck(checks, 'p0_evidence', expected.persistence.includes('p0_evidence'), 'P0 cases must persist release evidence');
    addCheck(checks, 'p0_assertion', includesAny(scenario.assertions, ['p0', 'guardrail']), 'P0 cases must assert guardrail behavior');
  }

  if (scenario.category === 'api_provider_resilience') {
    addCheck(checks, 'provider_contract', expected.api.includes('typed_result_contract'), 'provider cases must validate typed contracts');
    addCheck(checks, 'provider_trace', expected.persistence.includes('provider_attempt_log'), 'provider cases must persist attempt logs');
  }

  if (scenario.category === 'operations_settlement_storage') {
    addCheck(checks, 'admin_guard', expected.api.includes('admin_guard'), 'operation cases must require admin guard');
    addCheck(checks, 'audit_log', expected.persistence.includes('audit_log'), 'operation cases must persist audit logs');
    addCheck(checks, 'decision_packet_ui', expected.ui.includes('one_click_decision_packet'), 'operation cases must expose one-click decision packet');
  }

  if (scenario.mockMode === 'provider_failure') {
    addCheck(
      checks,
      'provider_failure_fallback',
      includesAny(scenario.assertions, ['fallback', 'retry', 'error']),
      'provider failures must assert fallback, retry, or error handling',
    );
  }

  if (scenario.mockMode === 'partial_failure') {
    addCheck(
      checks,
      'partial_failure_safe_data',
      includesAny(scenario.assertions, ['partial', 'safe confirmed']),
      'partial failures must keep safe confirmed data',
    );
  }

  if (scenario.mockMode === 'admin_auth') {
    addCheck(
      checks,
      'admin_approval_guard',
      includesAny(scenario.assertions, ['admin', 'approval']) && expected.api.includes('admin_guard'),
      'admin actions must require an approval guard',
    );
  }

  if (scenario.mockMode === 'dry_run') {
    addCheck(
      checks,
      'dry_run_non_mutating',
      includesAny(scenario.assertions, ['dry-run', 'does not mutate']),
      'dry-run cases must assert non-mutating behavior',
    );
  }

  return {
    id: scenario.id,
    priority: scenario.priority,
    category: scenario.category,
    title: scenario.title,
    passed: checks.every((check) => check.passed),
    checks,
  };
}

function buildSectionScores(results: FreeTravelScenarioResult[]): FreeTravelScenarioSectionScore[] {
  const categories: FreeTravelScenarioCategory[] = [
    'search_recommendation_ux',
    'api_provider_resilience',
    'operations_settlement_storage',
  ];

  return categories.map((category) => {
    const scoped = results.filter((result) => result.category === category);
    const passed = scoped.filter((result) => result.passed).length;
    return {
      category,
      total: scoped.length,
      passed,
      score: scoped.length === 0 ? 0 : Math.round((passed / scoped.length) * 100),
    };
  });
}

export function evaluateFreeTravel100Scenarios(
  scenarios: FreeTravelScenarioCase[] = FREE_TRAVEL_SCENARIO_CASES,
): FreeTravelScenarioEvaluation {
  const idCounts = new Map<number, number>();
  for (const scenario of scenarios) {
    idCounts.set(scenario.id, (idCounts.get(scenario.id) ?? 0) + 1);
  }

  const results = scenarios.map((scenario) => evaluateScenario(scenario, idCounts));
  const existingIds = new Set(scenarios.map((scenario) => scenario.id));
  const missingIds = EXPECTED_IDS.filter((id) => !existingIds.has(id));

  if (missingIds.length > 0) {
    for (const missingId of missingIds) {
      results.push({
        id: missingId,
        priority: expectedPriority(missingId),
        category: expectedCategory(missingId),
        title: `Missing scenario ${missingId}`,
        passed: false,
        checks: [{
          name: 'scenario_present',
          passed: false,
          message: 'scenario id is missing from executable corpus',
        }],
      });
    }
  }

  const total = results.length;
  const passed = results.filter((result) => result.passed).length;
  const score = total === 0 ? 0 : Math.round((passed / total) * 100);
  const p0Results = results.filter((result) => result.priority === 'P0');
  const p0Passed = p0Results.filter((result) => result.passed).length;
  const p0Failures = p0Results.filter((result) => !result.passed);
  const priorityCounts: Record<FreeTravelScenarioPriority, number> = {
    P0: results.filter((result) => result.priority === 'P0').length,
    P1: results.filter((result) => result.priority === 'P1').length,
    P2: results.filter((result) => result.priority === 'P2').length,
  };
  const status = p0Failures.length > 0 || score < 95
    ? 'fail'
    : passed === total
      ? 'pass'
      : 'warn';

  return {
    ok: status !== 'fail',
    status,
    score,
    maxScore: 100,
    total,
    passed,
    failed: total - passed,
    p0Total: p0Results.length,
    p0Passed,
    p0Failures,
    priorityCounts,
    sectionScores: buildSectionScores(results),
    results,
  };
}
