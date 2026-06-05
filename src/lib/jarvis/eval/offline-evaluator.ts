import { detectPromptInjection } from '@/lib/guardrails/prompt-injection';
import { decideHitlReviewStatus } from '../hitl-execution';
import { filterAllowedToolsByProfile, isAgentAllowedByProfile } from '../persona';
import { filterGuestTools } from '../guest-guardrail';
import { resolveSpecialist } from '../orchestration';
import { requiresApproval, scoreRiskLevel } from '../risk-scorer';
import type { JarvisContext } from '../types';
import type { JarvisGoldenCase } from './golden-cases';
import { JARVIS_GOLDEN_CASES } from './golden-cases';

type ToolLike = { name: string };

const DEFAULT_TOOL_CATALOG: ToolLike[] = [
  { name: 'search_packages' },
  { name: 'get_bookings' },
  { name: 'create_booking' },
  { name: 'match_payment' },
  { name: 'process_gdpr_request' },
];

export interface JarvisEvalCheck {
  name: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
}

export interface JarvisEvalCaseResult {
  id: string;
  category: JarvisGoldenCase['category'];
  description: string;
  passed: boolean;
  checks: JarvisEvalCheck[];
}

export interface JarvisEvalSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  results: JarvisEvalCaseResult[];
}

function addCheck(checks: JarvisEvalCheck[], name: string, expected: unknown, actual: unknown) {
  checks.push({ name, expected, actual, passed: Object.is(expected, actual) });
}

function evaluateGuestTools(testCase: JarvisGoldenCase, checks: JarvisEvalCheck[]) {
  const ctx = testCase.expected.guestContext;
  if (!ctx) return;

  const visibleTools = new Set(filterGuestTools(DEFAULT_TOOL_CATALOG, ctx).map((tool) => tool.name));

  for (const toolName of testCase.expected.guestBlockedTools ?? []) {
    addCheck(checks, `guest_blocks_${toolName}`, false, visibleTools.has(toolName));
  }
  for (const toolName of testCase.expected.guestAllowedTools ?? []) {
    addCheck(checks, `guest_allows_${toolName}`, true, visibleTools.has(toolName));
  }
}

function evaluateSpecialist(testCase: JarvisGoldenCase, checks: JarvisEvalCheck[]) {
  const agentType = testCase.expected.agentType;
  const specialistId = testCase.expected.specialistId;
  if (!agentType || !specialistId) return;

  const ctx: JarvisContext = testCase.expected.guestContext ?? { userRole: 'platform_admin', surface: 'admin' };
  const picked = resolveSpecialist(agentType, testCase.message, ctx);
  addCheck(checks, 'specialist_id', specialistId, picked.specialistId);
}

function evaluateTenantProductization(testCase: JarvisGoldenCase, checks: JarvisEvalCheck[]) {
  if (typeof testCase.expected.tenantAgentAllowed === 'boolean' && testCase.expected.tenantAgentType) {
    addCheck(
      checks,
      'tenant_agent_allowed',
      testCase.expected.tenantAgentAllowed,
      isAgentAllowedByProfile(
        { allowed_agents: testCase.expected.tenantAllowedAgents ?? null },
        testCase.expected.tenantAgentType,
        testCase.expected.tenantContext ?? { tenantId: 'tenant_demo', userRole: 'tenant_admin', surface: 'admin' },
      ),
    );
  }

  if (testCase.expected.tenantAllowedTools && testCase.expected.tenantVisibleTools) {
    const tools = [
      { name: 'knowledge_search' },
      { name: 'recommend_best_packages' },
      { name: 'create_booking' },
    ];
    const visible = filterAllowedToolsByProfile(tools, {
      allowed_tools: testCase.expected.tenantAllowedTools,
    }).map(tool => tool.name);
    addCheck(checks, 'tenant_visible_tools', testCase.expected.tenantVisibleTools.join(','), visible.join(','));
  }
}

export function evaluateJarvisGoldenCase(testCase: JarvisGoldenCase): JarvisEvalCaseResult {
  const checks: JarvisEvalCheck[] = [];

  if (typeof testCase.expected.promptInjectionBlocked === 'boolean') {
    addCheck(
      checks,
      'prompt_injection_blocked',
      testCase.expected.promptInjectionBlocked,
      detectPromptInjection(testCase.message).blocked,
    );
  }

  if (testCase.expected.riskLevel) {
    const actualRisk = scoreRiskLevel({ message: testCase.message });
    addCheck(checks, 'risk_level', testCase.expected.riskLevel, actualRisk);
    if (typeof testCase.expected.requiresApproval === 'boolean') {
      addCheck(checks, 'requires_approval', testCase.expected.requiresApproval, requiresApproval(actualRisk));
    }
  }

  if (testCase.expected.failedExecutionNextStatus) {
    const decision = decideHitlReviewStatus({ approved: true, executionSuccess: false });
    addCheck(checks, 'failed_execution_next_status', testCase.expected.failedExecutionNextStatus, decision.nextStatus);
    addCheck(checks, 'failed_execution_retryable', testCase.expected.failedExecutionRetryable, decision.retryable);
  }

  evaluateGuestTools(testCase, checks);
  evaluateSpecialist(testCase, checks);
  evaluateTenantProductization(testCase, checks);

  return {
    id: testCase.id,
    category: testCase.category,
    description: testCase.description,
    checks,
    passed: checks.length > 0 && checks.every((check) => check.passed),
  };
}

export function evaluateJarvisGoldenSet(cases: JarvisGoldenCase[] = JARVIS_GOLDEN_CASES): JarvisEvalSummary {
  const results = cases.map(evaluateJarvisGoldenCase);
  const passed = results.filter((result) => result.passed).length;
  const total = results.length;
  return {
    total,
    passed,
    failed: total - passed,
    passRate: total === 0 ? 0 : passed / total,
    results,
  };
}
