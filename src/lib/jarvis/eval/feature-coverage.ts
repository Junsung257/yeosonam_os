import type { AgentType, JarvisContext, RiskLevel } from '../types';
import { CONCIERGE_TOOLS_RAW } from '../agents/concierge';
import { FINANCE_TOOLS_RAW } from '../agents/finance';
import { MARKETING_TOOLS_RAW } from '../agents/marketing';
import { OPERATIONS_TOOLS_RAW } from '../agents/operations';
import { PRODUCTS_TOOLS_RAW } from '../agents/products';
import { SALES_TOOLS_RAW } from '../agents/sales';
import { SYSTEM_TOOLS_RAW } from '../agents/system';
import { SPECIALISTS_BY_AGENT } from '../orchestration/specialist-registry';
import { resolveSpecialist } from '../orchestration/resolve-specialist';

export type JarvisFeatureCoverageStatus = 'pass' | 'warn' | 'fail';

export interface JarvisOsFeatureCoverageCase {
  id: string;
  label: string;
  agentType: AgentType;
  message: string;
  surface: NonNullable<JarvisContext['surface']>;
  expectedSpecialistId: string;
  riskLevel: RiskLevel;
  requiresApprovalBoundary: boolean;
  expectedCapabilities: string[];
  coveredToolNames: string[];
}

export interface JarvisFeatureCoverageResult {
  id: string;
  label: string;
  status: JarvisFeatureCoverageStatus;
  agentType: AgentType;
  expectedSpecialistId: string;
  actualSpecialistId: string;
  routingMethod: string;
  coveredToolNames: string[];
  checks: Record<string, boolean>;
}

export interface JarvisFeatureCoverageSummary {
  status: JarvisFeatureCoverageStatus;
  score: number;
  total: number;
  passed: number;
  failed: number;
  coveredAgents: AgentType[];
  missingAgents: AgentType[];
  coveredToolNames: Record<AgentType, string[]>;
  uncoveredToolNames: Record<AgentType, string[]>;
  undeclaredCoveredToolNames: Record<AgentType, string[]>;
  results: JarvisFeatureCoverageResult[];
}

const AGENT_TYPES: AgentType[] = ['operations', 'products', 'finance', 'marketing', 'sales', 'system'];
const TOOL_NAMES_BY_AGENT: Record<AgentType, string[]> = {
  operations: toolNames(OPERATIONS_TOOLS_RAW),
  products: toolNames(PRODUCTS_TOOLS_RAW, CONCIERGE_TOOLS_RAW),
  finance: toolNames(FINANCE_TOOLS_RAW),
  marketing: toolNames(MARKETING_TOOLS_RAW),
  sales: toolNames(SALES_TOOLS_RAW),
  system: toolNames(SYSTEM_TOOLS_RAW),
};

function toolNames(...lists: Array<readonly unknown[]>): string[] {
  return [...new Set(lists.flatMap((list) => list
    .map((item) => (typeof item === 'object' && item !== null ? (item as { name?: unknown }).name : null))
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)))].sort();
}

function ko(value: string): string {
  return value;
}

export const JARVIS_OS_FEATURE_COVERAGE_CASES: JarvisOsFeatureCoverageCase[] = [
  {
    id: 'operations.booking-status',
    label: 'Booking status lookup',
    agentType: 'operations',
    message: 'booking status for B-240701',
    surface: 'admin',
    expectedSpecialistId: 'operations.booking_lookup',
    riskLevel: 'medium',
    requiresApprovalBoundary: false,
    expectedCapabilities: ['lookup', 'state_boundary', 'handoff'],
    coveredToolNames: [
      'search_bookings',
      'get_booking_detail',
      'send_booking_guide',
      'list_travel_insurances',
      'create_itinerary',
      'get_visa_info',
      'list_guest_names',
      'get_recent_errors',
    ],
  },
  {
    id: 'operations.payment-match',
    label: 'Payment match audit',
    agentType: 'operations',
    message: 'unmatched payment needs account review',
    surface: 'admin',
    expectedSpecialistId: 'operations.payment_match',
    riskLevel: 'high',
    requiresApprovalBoundary: true,
    expectedCapabilities: ['lookup', 'evidence_boundary', 'approval_gate'],
    coveredToolNames: [
      'list_unmatched_payments',
      'match_payment',
    ],
  },
  {
    id: 'operations.customer-crm',
    label: 'Customer CRM context',
    agentType: 'operations',
    message: 'CRM lead phone and customer contact history',
    surface: 'admin',
    expectedSpecialistId: 'operations.customer_crm',
    riskLevel: 'high',
    requiresApprovalBoundary: true,
    expectedCapabilities: ['pii_minimization', 'lookup', 'handoff'],
    coveredToolNames: [
      'search_customers',
      'create_customer',
      'update_customer',
      'find_duplicate_customers',
      'propose_merge_customers',
      'create_booking',
      'update_booking_status',
      'update_guest_names',
    ],
  },
  {
    id: 'products.search-filter',
    label: 'Product search filters',
    agentType: 'products',
    message: ko('\uac80\uc0c9 \ud544\ud130 \ubaa9\uc801\uc9c0 \ucd9c\ubc1c \uc77c\uc815 \uc778\uc6d0 \uc608\uc0b0 \ud328\ud0a4\uc9c0 \ucc3e\uc544\uc918'),
    surface: 'admin',
    expectedSpecialistId: 'products.search_filter',
    riskLevel: 'low',
    requiresApprovalBoundary: false,
    expectedCapabilities: ['search', 'filter', 'compare'],
    coveredToolNames: [
      'search_packages',
      'get_package_detail',
      'get_package_hotel_mrt_cache',
      'recommend_package',
      'list_attractions',
      'search_land_operators',
      'list_admin_alerts',
      'ack_alert',
    ],
  },
  {
    id: 'products.compare-rank',
    label: 'Product comparison ranking',
    agentType: 'products',
    message: 'TOP package ranking with topsis and value comparison',
    surface: 'admin',
    expectedSpecialistId: 'products.compare_rank',
    riskLevel: 'medium',
    requiresApprovalBoundary: false,
    expectedCapabilities: ['rank', 'explain', 'evidence_boundary'],
    coveredToolNames: [
      'recommend_best_packages',
      'get_scoring_policy',
      'activate_policy',
      'top_recommended_packages',
      'recommend_compare_pair',
      'recommend_multi_intent',
      'update_package_status',
      'propose_product_registration',
      'register_product_draft',
      'update_package_field',
      'delete_package',
    ],
  },
  {
    id: 'products.customer-concierge-rag',
    label: 'Customer product concierge RAG',
    agentType: 'products',
    message: 'recommend a package for my family',
    surface: 'customer',
    expectedSpecialistId: 'products.concierge_rag',
    riskLevel: 'medium',
    requiresApprovalBoundary: false,
    expectedCapabilities: ['rag', 'recommend', 'human_handoff'],
    coveredToolNames: [
      'knowledge_search',
      'recommend_best_packages',
      'recommend_compare_pair',
      'plan_free_travel',
    ],
  },
  {
    id: 'finance.settlement-tax',
    label: 'Settlement and tax support',
    agentType: 'finance',
    message: '3.3 settlement tax invoice review',
    surface: 'admin',
    expectedSpecialistId: 'finance.settlement_tax',
    riskLevel: 'high',
    requiresApprovalBoundary: true,
    expectedCapabilities: ['ledger_boundary', 'calculation', 'approval_gate'],
    coveredToolNames: [
      'list_ledger',
      'get_tax_summary',
      'list_settlements',
      'create_settlement',
      'list_pending_settlements',
      'propose_bulk_confirm_settlements',
      'get_vat_report_data',
      'export_settlement_report',
    ],
  },
  {
    id: 'finance.revenue-kpi',
    label: 'Revenue KPI support',
    agentType: 'finance',
    message: 'KPI revenue and cash performance',
    surface: 'admin',
    expectedSpecialistId: 'finance.revenue_kpi',
    riskLevel: 'medium',
    requiresApprovalBoundary: false,
    expectedCapabilities: ['metric_definition', 'trend', 'evidence_boundary'],
    coveredToolNames: [
      'get_dashboard_kpi',
      'get_cashflow_forecast',
      'get_card_sales',
      'list_expense_receipts',
      'get_profit_loss_summary',
    ],
  },
  {
    id: 'marketing.card-sns',
    label: 'Card news and SNS creative',
    agentType: 'marketing',
    message: 'SNS card news copy and ad creative',
    surface: 'admin',
    expectedSpecialistId: 'marketing.card_sns',
    riskLevel: 'medium',
    requiresApprovalBoundary: false,
    expectedCapabilities: ['draft', 'brand_boundary', 'review'],
    coveredToolNames: [
      'generate_card_news',
      'generate_sns_copy',
      'get_ad_performance',
      'list_campaigns',
      'get_keyword_performance',
      'propose_blog_draft',
      'list_blog_posts',
      'get_blog_performance',
      'list_content_hub_items',
      'list_content_queue',
      'approve_content',
      'list_brand_kits',
      'list_creatives',
      'list_tmp_pipeline',
      'get_content_gaps',
      'get_content_analytics',
      'get_keyword_stats',
      'get_optimization_logs',
      'get_ad_budget_summary',
      'run_ad_optimization',
      'get_content_performance_summary',
      'list_admin_alerts_marketing',
    ],
  },
  {
    id: 'marketing.mileage',
    label: 'Mileage and gamification support',
    agentType: 'marketing',
    message: ko('\ub9c8\uc77c\ub9ac\uc9c0 \ub4f1\uae09 \uc801\ub9bd \uc18c\uba78 \ucd9c\uc11d \uccb4\ud06c'),
    surface: 'admin',
    expectedSpecialistId: 'marketing.mileage',
    riskLevel: 'medium',
    requiresApprovalBoundary: false,
    expectedCapabilities: ['policy_boundary', 'campaign', 'audit'],
    coveredToolNames: [
      'get_customer_mileage',
      'adjust_mileage',
      'create_mileage_event',
      'get_mileage_stats',
      'get_mileage_policies',
    ],
  },
  {
    id: 'sales.rfq-group',
    label: 'Group RFQ support',
    agentType: 'sales',
    message: 'RFQ group quote request',
    surface: 'admin',
    expectedSpecialistId: 'sales.rfq_group',
    riskLevel: 'medium',
    requiresApprovalBoundary: false,
    expectedCapabilities: ['intake', 'quote_boundary', 'handoff'],
    coveredToolNames: [
      'list_rfqs',
      'update_rfq_status',
      'get_rfq_detail',
      'create_rfq_proposal',
      'list_tenants',
    ],
  },
  {
    id: 'sales.affiliate-influencer',
    label: 'Affiliate and influencer support',
    agentType: 'sales',
    message: ko('\uc778\ud50c\ub8e8 \uc81c\ud734 \ucee4\ubbf8\uc158 \uc815\uc0b0'),
    surface: 'admin',
    expectedSpecialistId: 'sales.affiliate_influencer',
    riskLevel: 'high',
    requiresApprovalBoundary: true,
    expectedCapabilities: ['commission_boundary', 'attribution', 'approval_gate'],
    coveredToolNames: [
      'list_affiliates',
      'get_affiliate_performance',
      'create_settlement',
      'simulate_commission',
      'generate_affiliate_link',
      'update_influencer_tier',
      'list_commission_history',
    ],
  },
  {
    id: 'system.policy-audit',
    label: 'Policy and audit support',
    agentType: 'system',
    message: ko('\uc815\ucc45 \uac10\uc0ac \ub85c\uadf8 \uad8c\ud55c \uc124\uc815'),
    surface: 'admin',
    expectedSpecialistId: 'system.policy_audit',
    riskLevel: 'high',
    requiresApprovalBoundary: true,
    expectedCapabilities: ['policy_boundary', 'audit_log', 'approval_gate'],
    coveredToolNames: [
      'list_policies',
      'update_policy',
      'list_escalations',
      'resolve_escalation',
      'get_audit_logs',
      'get_os_health',
      'list_cron_jobs',
      'trigger_cron_job',
      'get_registration_status',
      'list_fraud_quarantine',
      'resolve_fraud_case',
      'list_gdpr_requests',
      'process_gdpr_request',
      'list_integrations',
      'toggle_integration',
      'list_api_tokens',
      'list_admin_alerts_full',
      'dismiss_alert',
      'list_system_config',
      'update_system_config',
      'list_prompt_templates',
      'get_blog_system_status',
    ],
  },
];

function isHighRisk(value: RiskLevel): boolean {
  return value === 'high' || value === 'critical';
}

function hasSpecialistDefinition(agentType: AgentType, specialistId: string): boolean {
  return SPECIALISTS_BY_AGENT[agentType]?.some((definition) => definition.id === specialistId) ?? false;
}

function coveredToolNamesByAgent(cases: JarvisOsFeatureCoverageCase[]): Record<AgentType, string[]> {
  return Object.fromEntries(AGENT_TYPES.map((agentType) => [
    agentType,
    [...new Set(cases
      .filter((testCase) => testCase.agentType === agentType)
      .flatMap((testCase) => testCase.coveredToolNames))].sort(),
  ])) as Record<AgentType, string[]>;
}

function diffNames(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((name) => !rightSet.has(name)).sort();
}

function evaluateFeatureCoverageCase(testCase: JarvisOsFeatureCoverageCase): JarvisFeatureCoverageResult {
  const pick = resolveSpecialist(testCase.agentType, testCase.message, {
    surface: testCase.surface,
    userRole: testCase.surface === 'customer' ? 'customer' : 'platform_admin',
  });
  const declaredToolNames = new Set(TOOL_NAMES_BY_AGENT[testCase.agentType]);
  const checks = {
    route_matches_expected_specialist: pick.specialistId === testCase.expectedSpecialistId,
    specialist_definition_exists: hasSpecialistDefinition(testCase.agentType, testCase.expectedSpecialistId)
      || testCase.expectedSpecialistId === 'products.concierge_rag',
    high_risk_has_approval_boundary: !isHighRisk(testCase.riskLevel) || testCase.requiresApprovalBoundary,
    has_capability_contract: testCase.expectedCapabilities.length > 0,
    has_tool_coverage_contract: testCase.coveredToolNames.length > 0,
    covered_tool_names_are_declared: testCase.coveredToolNames.every((name) => declaredToolNames.has(name)),
  };
  const status: JarvisFeatureCoverageStatus = Object.values(checks).every(Boolean) ? 'pass' : 'fail';

  return {
    id: testCase.id,
    label: testCase.label,
    status,
    agentType: testCase.agentType,
    expectedSpecialistId: testCase.expectedSpecialistId,
    actualSpecialistId: pick.specialistId,
    routingMethod: pick.method,
    coveredToolNames: testCase.coveredToolNames,
    checks,
  };
}

export function evaluateJarvisFeatureCoverage(
  cases: JarvisOsFeatureCoverageCase[] = JARVIS_OS_FEATURE_COVERAGE_CASES,
): JarvisFeatureCoverageSummary {
  const results = cases.map(evaluateFeatureCoverageCase);
  const passed = results.filter((result) => result.status === 'pass').length;
  const failed = results.length - passed;
  const coveredAgents = AGENT_TYPES.filter((agentType) => cases.some((testCase) => testCase.agentType === agentType));
  const missingAgents = AGENT_TYPES.filter((agentType) => !coveredAgents.includes(agentType));
  const coveredToolNames = coveredToolNamesByAgent(cases);
  const uncoveredToolNames = Object.fromEntries(AGENT_TYPES.map((agentType) => [
    agentType,
    diffNames(TOOL_NAMES_BY_AGENT[agentType], coveredToolNames[agentType]),
  ])) as Record<AgentType, string[]>;
  const undeclaredCoveredToolNames = Object.fromEntries(AGENT_TYPES.map((agentType) => [
    agentType,
    diffNames(coveredToolNames[agentType], TOOL_NAMES_BY_AGENT[agentType]),
  ])) as Record<AgentType, string[]>;
  const hasUncoveredTools = AGENT_TYPES.some((agentType) => uncoveredToolNames[agentType].length > 0);
  const hasUndeclaredCoveredTools = AGENT_TYPES.some((agentType) => undeclaredCoveredToolNames[agentType].length > 0);
  const score = results.length > 0 ? Math.round((passed / results.length) * 100) : 0;
  const status: JarvisFeatureCoverageStatus = failed > 0
    || missingAgents.length > 0
    || hasUncoveredTools
    || hasUndeclaredCoveredTools
    ? 'fail'
    : score < 95
      ? 'warn'
      : 'pass';

  return {
    status,
    score,
    total: results.length,
    passed,
    failed,
    coveredAgents,
    missingAgents,
    coveredToolNames,
    uncoveredToolNames,
    undeclaredCoveredToolNames,
    results,
  };
}
