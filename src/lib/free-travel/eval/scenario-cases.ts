export type FreeTravelScenarioPriority = 'P0' | 'P1' | 'P2';

export type FreeTravelScenarioCategory =
  | 'search_recommendation_ux'
  | 'api_provider_resilience'
  | 'operations_settlement_storage';

export type FreeTravelScenarioMockMode =
  | 'deterministic'
  | 'provider_success'
  | 'provider_failure'
  | 'partial_failure'
  | 'admin_auth'
  | 'dry_run';

export interface FreeTravelScenarioCase {
  id: number;
  priority: FreeTravelScenarioPriority;
  category: FreeTravelScenarioCategory;
  title: string;
  input: string;
  expected: {
    api: string[];
    ui: string[];
    persistence: string[];
  };
  mockMode: FreeTravelScenarioMockMode;
  assertions: string[];
}

export const FREE_TRAVEL_P0_IDS = [
  1, 2, 3, 4, 12, 14, 20, 27, 28, 30, 36, 37, 39, 41, 46, 47, 48, 61, 63, 65,
  70, 71, 79, 80, 82, 84, 88, 96, 97, 98,
] as const;

export const FREE_TRAVEL_P1_IDS = [
  5, 6, 7, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 31, 32, 40, 42, 43, 45,
  49, 52, 53, 54, 55, 56, 57, 58, 59, 60, 72, 73, 74, 75, 76, 77, 78, 81, 83, 85,
] as const;

const P0_SET = new Set<number>(FREE_TRAVEL_P0_IDS);
const P1_SET = new Set<number>(FREE_TRAVEL_P1_IDS);

const TITLES: Record<number, string> = {
  1: 'Real-time package search to recommendation list',
  2: 'Destination/date/persona input validation',
  3: 'Budget and hotel grade ranking',
  4: 'Family traveller safety and schedule fit',
  12: 'Empty result fallback with actionable alternatives',
  14: 'Duplicate result de-duplication',
  20: 'Selected package explanation with source refs',
  27: 'Guest surface blocks mutation tools',
  28: 'Prompt injection attempt is blocked',
  30: 'PII redaction in customer-facing response',
  36: 'Provider timeout retries and graceful fallback',
  37: 'Provider 500 error produces partial result',
  39: 'Malformed provider payload is rejected',
  41: 'Currency and total price normalization',
  46: 'Flight provider unavailable fallback',
  47: 'Hotel provider unavailable fallback',
  48: 'Activity provider unavailable fallback',
  61: 'Partial itinerary keeps confirmed blocks',
  63: 'Inventory conflict resolution',
  65: 'Unavailable option replacement',
  70: 'Cross-provider trace is persisted',
  71: 'Admin-only one-click approval packet',
  79: 'Booking draft audit log',
  80: 'Payment pending state guard',
  82: 'Settlement dry-run preview',
  84: 'Refund approval guard',
  88: 'External message draft requires approval',
  96: 'Admin auth required for execution',
  97: 'Tenant isolation for action packet',
  98: 'One-click approval records actor and evidence',
};

function priorityForId(id: number): FreeTravelScenarioPriority {
  if (P0_SET.has(id)) return 'P0';
  if (P1_SET.has(id)) return 'P1';
  return 'P2';
}

function categoryForId(id: number): FreeTravelScenarioCategory {
  if (id <= 35) return 'search_recommendation_ux';
  if (id <= 70) return 'api_provider_resilience';
  return 'operations_settlement_storage';
}

function mockModeForId(id: number): FreeTravelScenarioMockMode {
  if ([36, 37, 39, 46, 47, 48, 52, 53, 54, 55, 56, 57, 58, 59, 60].includes(id)) {
    return 'provider_failure';
  }
  if ([40, 41, 42, 43, 45, 49].includes(id)) return 'provider_success';
  if ([61, 63, 65, 70].includes(id)) return 'partial_failure';
  if ([71, 79, 80, 82, 84, 88, 96, 97, 98].includes(id)) return 'admin_auth';
  if (id >= 72) return 'dry_run';
  return 'deterministic';
}

function expectedForCase(
  id: number,
  category: FreeTravelScenarioCategory,
  priority: FreeTravelScenarioPriority,
): FreeTravelScenarioCase['expected'] {
  const expected: FreeTravelScenarioCase['expected'] = {
    api: [],
    ui: [],
    persistence: ['scenario_trace'],
  };

  if (category === 'search_recommendation_ux') {
    expected.api.push('plan_free_travel', 'search_packages', 'recommend_compare_pair');
    expected.ui.push('ranked_result_list', 'source_backed_explanation', 'empty_state_or_alternative');
  }

  if (category === 'api_provider_resilience') {
    expected.api.push('provider_adapter', 'timeout_retry_policy', 'typed_result_contract');
    expected.ui.push('provider_status_notice', 'partial_result_explanation');
    expected.persistence.push('provider_attempt_log');
  }

  if (category === 'operations_settlement_storage') {
    expected.api.push('admin_guard', 'approval_or_dry_run', 'agent_action_packet');
    expected.ui.push('one_click_decision_packet', 'risk_badge', 'rollback_hint');
    expected.persistence.push('audit_log', 'tenant_id_scope', 'no_pii_leak');
  }

  if (priority === 'P0') {
    expected.api.push('p0_guardrail');
    expected.persistence.push('p0_evidence');
  }

  if ([27, 28, 30, 96, 97, 98].includes(id)) {
    expected.api.push('security_policy_check');
    expected.persistence.push('security_audit_event');
  }

  return expected;
}

function assertionsForCase(
  id: number,
  category: FreeTravelScenarioCategory,
  priority: FreeTravelScenarioPriority,
  mockMode: FreeTravelScenarioMockMode,
): string[] {
  const assertions = [
    'input is parsed into a typed scenario request',
    'response includes user-facing evidence',
  ];

  if (priority === 'P0') assertions.push('P0 guardrail is enforced');
  if (category === 'search_recommendation_ux') assertions.push('recommendation ranking is deterministic');
  if (category === 'api_provider_resilience') assertions.push('provider result contract is validated');
  if (category === 'operations_settlement_storage') assertions.push('admin audit trail is recorded');
  if (mockMode === 'provider_failure') assertions.push('fallback handles provider error or retry exhaustion');
  if (mockMode === 'partial_failure') assertions.push('partial failure keeps safe confirmed data');
  if (mockMode === 'admin_auth') assertions.push('admin approval guard is required before execution');
  if (mockMode === 'dry_run') assertions.push('dry-run preview does not mutate live records');
  if ([28, 30, 97].includes(id)) assertions.push('security and tenant isolation policy passes');

  return assertions;
}

function buildScenarioCase(id: number): FreeTravelScenarioCase {
  const priority = priorityForId(id);
  const category = categoryForId(id);
  const mockMode = mockModeForId(id);
  const title = TITLES[id] ?? `${category.replace(/_/g, ' ')} scenario ${id}`;

  return {
    id,
    priority,
    category,
    title,
    input: `free-travel-scenario-${id}`,
    expected: expectedForCase(id, category, priority),
    mockMode,
    assertions: assertionsForCase(id, category, priority, mockMode),
  };
}

export const FREE_TRAVEL_SCENARIO_CASES: FreeTravelScenarioCase[] = Array.from(
  { length: 100 },
  (_, index) => buildScenarioCase(index + 1),
);
