import type { AgentRiskLevel } from '@/lib/agent/envelope';
import type { AgentType } from '@/lib/jarvis/types';

export type DecisionRecommendation = 'approve' | 'hold' | 'reject';
export type DecisionCheckStatus = 'pass' | 'warn' | 'fail';
export type ActionExposure = 'agent_action' | 'jarvis_tool';

export interface DecisionEvidence {
  label: string;
  value: string;
  source: 'payload' | 'registry' | 'system';
}

export interface DecisionCheck {
  id: string;
  label: string;
  status: DecisionCheckStatus;
  detail?: string;
}

export interface ActionRegistryEntry {
  actionType: string;
  agentType: AgentType;
  title: string;
  description: string;
  riskLevel: AgentRiskLevel;
  requiresApproval: boolean;
  exposures: ActionExposure[];
  requiredPayloadKeys?: string[];
  requiredEvidence: string[];
  predictedEffects: string[];
  rollbackHint: string;
}

export interface ActionDryRunResult {
  ok: boolean;
  mode: 'dry_run';
  actionType: string;
  riskLevel: AgentRiskLevel;
  requiresApproval: boolean;
  checks: DecisionCheck[];
  evidence: DecisionEvidence[];
  blockers: string[];
  warnings: string[];
  predictedEffects: string[];
  rollbackHint: string;
  generatedAt: string;
}

export interface AutopilotDecisionPacket {
  actionType: string;
  agentType: AgentType | 'unknown';
  title: string;
  summary: string;
  riskLevel: AgentRiskLevel;
  requiresApproval: boolean;
  recommendation: DecisionRecommendation;
  recommendationReason: string;
  confidence: number;
  requiredEvidence: string[];
  evidence: DecisionEvidence[];
  dryRun: ActionDryRunResult;
  rollbackHint: string;
  generatedAt: string;
}

type EntryInput = Omit<ActionRegistryEntry, 'requiredEvidence' | 'predictedEffects' | 'rollbackHint' | 'requiresApproval' | 'exposures'> & {
  requiredEvidence?: string[];
  predictedEffects?: string[];
  rollbackHint?: string;
  requiresApproval?: boolean;
  exposures?: ActionExposure[];
};

function entry(input: EntryInput): ActionRegistryEntry {
  const requiresApproval = input.requiresApproval ?? true;
  return {
    ...input,
    requiresApproval,
    exposures: input.exposures ?? ['agent_action', 'jarvis_tool'],
    requiredEvidence: input.requiredEvidence ?? ['payload identifiers', 'operator reason'],
    predictedEffects: input.predictedEffects ?? ['database rows may change after approval'],
    rollbackHint: input.rollbackHint ?? 'Use audit logs and the affected record id to reverse or repair manually.',
  };
}

const MONEY_EVIDENCE = ['amount or settlement ids', 'affected booking/customer ids', 'operator reason'];
const BOOKING_EVIDENCE = ['booking id or booking number', 'before/after state', 'operator reason'];
const CUSTOMER_EVIDENCE = ['customer id', 'changed fields', 'operator reason'];
const POLICY_EVIDENCE = ['policy/config id', 'before/after state', 'operator reason'];
const CONTENT_EVIDENCE = ['content id', 'target channel', 'approval reason'];

export const ACTION_REGISTRY = {
  create_booking: entry({
    actionType: 'create_booking',
    agentType: 'operations',
    title: 'Create booking',
    description: 'Create a new booking record.',
    riskLevel: 'high',
    requiredPayloadKeys: ['package_id'],
    requiredEvidence: BOOKING_EVIDENCE,
    predictedEffects: ['a booking row is inserted', 'customer and package references become operational data'],
    rollbackHint: 'Void or cancel the booking and keep the audit trail.',
  }),
  update_booking_status: entry({
    actionType: 'update_booking_status',
    agentType: 'operations',
    title: 'Update booking status',
    description: 'Change a booking state.',
    riskLevel: 'high',
    requiredPayloadKeys: ['booking_id', 'status'],
    requiredEvidence: BOOKING_EVIDENCE,
    predictedEffects: ['booking status changes', 'downstream guide/payment/settlement views can change'],
    rollbackHint: 'Move the booking back through an allowed status transition with reason.',
  }),
  create_customer: entry({
    actionType: 'create_customer',
    agentType: 'operations',
    title: 'Create customer',
    description: 'Create a customer profile.',
    riskLevel: 'medium',
    requiredPayloadKeys: ['name'],
    requiredEvidence: CUSTOMER_EVIDENCE,
    predictedEffects: ['customer row is inserted'],
    rollbackHint: 'Soft-delete or merge the customer if duplicate.',
  }),
  update_customer: entry({
    actionType: 'update_customer',
    agentType: 'operations',
    title: 'Update customer',
    description: 'Update customer profile fields.',
    riskLevel: 'high',
    requiredPayloadKeys: ['customer_id'],
    requiredEvidence: CUSTOMER_EVIDENCE,
    predictedEffects: ['customer fields are changed'],
    rollbackHint: 'Restore fields from audit/decision packet snapshots.',
  }),
  match_payment: entry({
    actionType: 'match_payment',
    agentType: 'operations',
    title: 'Match payment',
    description: 'Attach a bank transaction to a booking.',
    riskLevel: 'critical',
    requiredPayloadKeys: ['transaction_id', 'booking_id'],
    requiredEvidence: MONEY_EVIDENCE,
    predictedEffects: ['bank transaction match status changes', 'booking payment view can change'],
    rollbackHint: 'Unmatch the bank transaction and rerun payment reconciliation.',
  }),
  send_booking_guide: entry({
    actionType: 'send_booking_guide',
    agentType: 'operations',
    title: 'Send booking guide',
    description: 'Send or log a booking guide message.',
    riskLevel: 'medium',
    requiredPayloadKeys: ['booking_id'],
    requiredEvidence: BOOKING_EVIDENCE,
    predictedEffects: ['customer-facing guide message may be sent or logged'],
    rollbackHint: 'Send a corrected guide and keep both message logs.',
  }),
  update_package_status: entry({
    actionType: 'update_package_status',
    agentType: 'products',
    title: 'Update package status',
    description: 'Change a travel package status.',
    riskLevel: 'high',
    requiredPayloadKeys: ['package_id', 'status'],
    requiredEvidence: ['package id', 'before/after status', 'operator reason'],
    predictedEffects: ['package visibility and sales availability can change'],
    rollbackHint: 'Set the package back to the previous status and rerun product gates.',
  }),
  create_settlement: entry({
    actionType: 'create_settlement',
    agentType: 'finance',
    title: 'Create settlement',
    description: 'Create a settlement record.',
    riskLevel: 'critical',
    requiredEvidence: MONEY_EVIDENCE,
    predictedEffects: ['settlement record is inserted', 'payable amounts can change'],
    rollbackHint: 'Reverse the settlement with a compensating record.',
  }),
  update_rfq_status: entry({
    actionType: 'update_rfq_status',
    agentType: 'sales',
    title: 'Update RFQ status',
    description: 'Change an RFQ state.',
    riskLevel: 'high',
    requiredPayloadKeys: ['rfq_id', 'status'],
    requiredEvidence: ['rfq id', 'before/after status', 'operator reason'],
    predictedEffects: ['RFQ workflow state changes'],
    rollbackHint: 'Move RFQ back through an allowed transition with reason.',
  }),
  update_policy: entry({
    actionType: 'update_policy',
    agentType: 'system',
    title: 'Update policy',
    description: 'Change an operating policy.',
    riskLevel: 'critical',
    requiredPayloadKeys: ['id'],
    requiredEvidence: POLICY_EVIDENCE,
    predictedEffects: ['policy behavior can change across the OS'],
    rollbackHint: 'Restore the previous policy value from the decision packet/audit log.',
  }),
  activate_policy: entry({
    actionType: 'activate_policy',
    agentType: 'products',
    title: 'Activate scoring policy',
    description: 'Switch the active scoring policy.',
    riskLevel: 'critical',
    requiredPayloadKeys: ['policy_id'],
    requiredEvidence: POLICY_EVIDENCE,
    predictedEffects: ['current scoring policy changes', 'future package ranking can change'],
    rollbackHint: 'Reactivate the previous scoring policy version.',
  }),
  register_product_draft: entry({
    actionType: 'register_product_draft',
    agentType: 'products',
    title: 'Register product draft',
    description: 'Create a draft travel package.',
    riskLevel: 'high',
    requiredPayloadKeys: ['title', 'destination'],
    requiredEvidence: ['source text/url', 'supplier or operator', 'price and itinerary checks'],
    predictedEffects: ['draft package is inserted'],
    rollbackHint: 'Delete or archive the draft package before publishing.',
  }),
  update_package_field: entry({
    actionType: 'update_package_field',
    agentType: 'products',
    title: 'Update package field',
    description: 'Update a single package field.',
    riskLevel: 'high',
    requiredPayloadKeys: ['package_id', 'field', 'value'],
    requiredEvidence: ['package id', 'old value', 'new value', 'operator reason'],
    predictedEffects: ['customer-visible product data may change'],
    rollbackHint: 'Restore the prior field value from the decision packet/audit log.',
  }),
  delete_package: entry({
    actionType: 'delete_package',
    agentType: 'products',
    title: 'Delete package',
    description: 'Delete a travel package.',
    riskLevel: 'critical',
    requiredPayloadKeys: ['package_id'],
    requiredEvidence: ['package id', 'dependency check', 'operator reason'],
    predictedEffects: ['package row is deleted', 'linked public pages may break'],
    rollbackHint: 'Restore from backup/export or recreate from the original registration source.',
  }),
  approve_content: entry({
    actionType: 'approve_content',
    agentType: 'marketing',
    title: 'Approve content',
    description: 'Approve a content review item.',
    riskLevel: 'high',
    requiredPayloadKeys: ['id'],
    requiredEvidence: CONTENT_EVIDENCE,
    predictedEffects: ['content moves to approved state'],
    rollbackHint: 'Move content back to review or archive it.',
  }),
  run_ad_optimization: entry({
    actionType: 'run_ad_optimization',
    agentType: 'marketing',
    title: 'Run ad optimization',
    description: 'Queue an ad optimization run.',
    riskLevel: 'high',
    requiredEvidence: ['platform', 'budget guardrail', 'dry-run result'],
    predictedEffects: ['ad optimization action is queued'],
    rollbackHint: 'Disable the queued action or reverse external changes through Ad OS change requests.',
  }),
  update_system_config: entry({
    actionType: 'update_system_config',
    agentType: 'system',
    title: 'Update system config',
    description: 'Change system configuration.',
    riskLevel: 'critical',
    requiredPayloadKeys: ['key', 'value'],
    requiredEvidence: POLICY_EVIDENCE,
    predictedEffects: ['system runtime behavior can change'],
    rollbackHint: 'Restore the previous config value.',
  }),
  trigger_cron_job: entry({
    actionType: 'trigger_cron_job',
    agentType: 'system',
    title: 'Trigger cron job',
    description: 'Manually trigger a cron job.',
    riskLevel: 'high',
    requiredPayloadKeys: ['job_name'],
    requiredEvidence: ['job name', 'reason', 'expected side effects'],
    predictedEffects: ['a cron trigger row is inserted'],
    rollbackHint: 'Cancel the pending trigger if supported, or mark follow-up incident if already run.',
  }),
  resolve_escalation: entry({
    actionType: 'resolve_escalation',
    agentType: 'system',
    title: 'Resolve escalation',
    description: 'Resolve an escalation item.',
    riskLevel: 'high',
    requiredPayloadKeys: ['id', 'resolution'],
    requiredEvidence: ['escalation id', 'resolution text', 'operator reason'],
    predictedEffects: ['escalation status becomes resolved'],
    rollbackHint: 'Reopen the escalation with a correction note.',
  }),
  dismiss_alert: entry({
    actionType: 'dismiss_alert',
    agentType: 'system',
    title: 'Dismiss alert',
    description: 'Mark an admin alert as read.',
    riskLevel: 'medium',
    requiredPayloadKeys: ['id'],
    requiredEvidence: ['alert id', 'reason'],
    predictedEffects: ['alert is hidden from active queues'],
    rollbackHint: 'Recreate or unacknowledge the alert if supported.',
  }),
  process_gdpr_request: entry({
    actionType: 'process_gdpr_request',
    agentType: 'system',
    title: 'Process GDPR request',
    description: 'Move a privacy deletion/export request into processing.',
    riskLevel: 'critical',
    requiredPayloadKeys: ['id'],
    requiredEvidence: ['privacy request id', 'identity verification', 'operator reason'],
    predictedEffects: ['privacy workflow state changes'],
    rollbackHint: 'Pause processing and document the correction immediately.',
  }),
  resolve_fraud_case: entry({
    actionType: 'resolve_fraud_case',
    agentType: 'system',
    title: 'Resolve fraud case',
    description: 'Release or confirm a fraud quarantine item.',
    riskLevel: 'critical',
    requiredPayloadKeys: ['id', 'action'],
    requiredEvidence: ['fraud case id', 'decision reason', 'operator approval'],
    predictedEffects: ['fraud quarantine state changes'],
    rollbackHint: 'Reopen quarantine and add an incident note.',
  }),
  toggle_integration: entry({
    actionType: 'toggle_integration',
    agentType: 'system',
    title: 'Toggle integration',
    description: 'Enable or disable an external integration.',
    riskLevel: 'critical',
    requiredPayloadKeys: ['id', 'is_active'],
    requiredEvidence: ['integration id', 'target state', 'operator reason'],
    predictedEffects: ['external platform connectivity can change'],
    rollbackHint: 'Toggle the integration back to the previous state.',
  }),
  create_itinerary: entry({
    actionType: 'create_itinerary',
    agentType: 'operations',
    title: 'Create itinerary',
    description: 'Create a booking itinerary proposal/action.',
    riskLevel: 'high',
    requiredPayloadKeys: ['booking_id'],
    requiredEvidence: BOOKING_EVIDENCE,
    predictedEffects: ['itinerary creation action is queued or generated'],
    rollbackHint: 'Archive the generated itinerary and regenerate from corrected data.',
  }),
  update_guest_names: entry({
    actionType: 'update_guest_names',
    agentType: 'operations',
    title: 'Update guest names',
    description: 'Update booking guest/passenger names.',
    riskLevel: 'high',
    requiredPayloadKeys: ['booking_id', 'guests'],
    requiredEvidence: BOOKING_EVIDENCE,
    predictedEffects: ['passenger/guest data can change'],
    rollbackHint: 'Restore the previous guest list from audit or booking history.',
  }),
  export_settlement_report: entry({
    actionType: 'export_settlement_report',
    agentType: 'finance',
    title: 'Export settlement report',
    description: 'Queue a settlement report export.',
    riskLevel: 'high',
    requiredPayloadKeys: ['target_type', 'period_from', 'period_to'],
    requiredEvidence: MONEY_EVIDENCE,
    predictedEffects: ['settlement export action is queued'],
    rollbackHint: 'Discard the report and regenerate after correction.',
  }),
  propose_bulk_confirm_settlements: entry({
    actionType: 'propose_bulk_confirm_settlements',
    agentType: 'finance',
    title: 'Propose bulk settlement confirmation',
    description: 'Create an approval action for bulk settlement confirmation.',
    riskLevel: 'high',
    requiredPayloadKeys: ['booking_ids', 'reason'],
    requiredEvidence: MONEY_EVIDENCE,
    predictedEffects: ['bulk settlement approval action is queued'],
    rollbackHint: 'Reject the queued action or reverse confirmed settlements.',
  }),
  generate_affiliate_link: entry({
    actionType: 'generate_affiliate_link',
    agentType: 'sales',
    title: 'Generate affiliate link',
    description: 'Create an affiliate tracking link action.',
    riskLevel: 'medium',
    requiredPayloadKeys: ['affiliate_id', 'landing_url'],
    requiredEvidence: ['affiliate id', 'landing url', 'operator reason'],
    predictedEffects: ['affiliate link creation action is queued'],
    rollbackHint: 'Disable or delete the generated link.',
  }),
  update_influencer_tier: entry({
    actionType: 'update_influencer_tier',
    agentType: 'sales',
    title: 'Update influencer tier',
    description: 'Change influencer/affiliate tier.',
    riskLevel: 'critical',
    requiredPayloadKeys: ['affiliate_id', 'new_tier'],
    requiredEvidence: ['affiliate id', 'before/after tier', 'commission impact'],
    predictedEffects: ['commission tier can change'],
    rollbackHint: 'Restore the previous tier and commission rate.',
  }),
  create_rfq_proposal: entry({
    actionType: 'create_rfq_proposal',
    agentType: 'sales',
    title: 'Create RFQ proposal',
    description: 'Queue an RFQ proposal submission.',
    riskLevel: 'high',
    requiredPayloadKeys: ['rfq_id'],
    requiredEvidence: ['rfq id', 'proposal text', 'cost/selling price evidence'],
    predictedEffects: ['RFQ proposal action is queued'],
    rollbackHint: 'Withdraw or supersede the proposal.',
  }),
  merge_customers: entry({
    actionType: 'merge_customers',
    agentType: 'operations',
    title: 'Merge customers',
    description: 'Merge duplicate customer records.',
    riskLevel: 'critical',
    requiredPayloadKeys: ['primary_id', 'duplicate_id'],
    requiredEvidence: ['primary customer', 'duplicate customer', 'duplicate evidence'],
    predictedEffects: ['customer references are reassigned', 'duplicate customer is soft-deleted'],
    rollbackHint: 'Restore the duplicate customer and reassign affected references manually.',
  }),
  bulk_confirm_settlements: entry({
    actionType: 'bulk_confirm_settlements',
    agentType: 'finance',
    title: 'Bulk confirm settlements',
    description: 'Confirm settlement state for multiple bookings.',
    riskLevel: 'critical',
    requiredPayloadKeys: ['booking_ids', 'reason'],
    requiredEvidence: MONEY_EVIDENCE,
    predictedEffects: ['multiple bookings can be marked settlement-confirmed'],
    rollbackHint: 'Reverse settlement confirmation for the affected bookings with a compensating audit note.',
  }),
  approve_monthly_settlement: entry({
    actionType: 'approve_monthly_settlement',
    agentType: 'finance',
    title: 'Approve monthly settlement',
    description: 'Apply a monthly affiliate settlement draft.',
    riskLevel: 'critical',
    requiredPayloadKeys: ['affiliate_id', 'period'],
    requiredEvidence: MONEY_EVIDENCE,
    predictedEffects: ['affiliate payout ledger can change'],
    rollbackHint: 'Apply a compensating settlement adjustment.',
  }),
  create_package: entry({
    actionType: 'create_package',
    agentType: 'products',
    title: 'Create package',
    description: 'Insert a travel package.',
    riskLevel: 'high',
    requiredPayloadKeys: ['title'],
    requiredEvidence: ['source text', 'supplier', 'price and itinerary checks'],
    predictedEffects: ['travel package row is inserted'],
    rollbackHint: 'Archive or delete the package before publishing.',
  }),
  register_product: entry({
    actionType: 'register_product',
    agentType: 'products',
    title: 'Register product proposal',
    description: 'Approval queue item for product registration handoff.',
    riskLevel: 'high',
    requiredPayloadKeys: ['title', 'destination'],
    requiredEvidence: ['source text', 'supplier', 'price and itinerary checks'],
    predictedEffects: ['registration handoff is approved for follow-up processing'],
    rollbackHint: 'Reject the registration handoff or archive the created draft.',
  }),
  create_affiliate_link: entry({
    actionType: 'create_affiliate_link',
    agentType: 'sales',
    title: 'Create affiliate link',
    description: 'Create an affiliate tracking link.',
    riskLevel: 'medium',
    requiredPayloadKeys: ['affiliate_id', 'landing_url'],
    requiredEvidence: ['affiliate id', 'landing url', 'operator reason'],
    predictedEffects: ['affiliate tracking entry can be created'],
    rollbackHint: 'Disable or delete the generated link.',
  }),
  submit_rfq_proposal: entry({
    actionType: 'submit_rfq_proposal',
    agentType: 'sales',
    title: 'Submit RFQ proposal',
    description: 'Submit an RFQ proposal.',
    riskLevel: 'high',
    requiredPayloadKeys: ['rfq_id', 'bid_id', 'tenant_id', 'total_cost', 'total_selling_price', 'checklist'],
    requiredEvidence: ['rfq id', 'proposal text', 'cost/selling price evidence'],
    predictedEffects: ['RFQ proposal can be submitted'],
    rollbackHint: 'Withdraw or supersede the proposal.',
  }),
  ad_optimization: entry({
    actionType: 'ad_optimization',
    agentType: 'marketing',
    title: 'Ad optimization action',
    description: 'Execute or queue ad optimization.',
    riskLevel: 'high',
    requiredEvidence: ['platform', 'budget guardrail', 'dry-run result'],
    predictedEffects: ['marketing optimization process can run'],
    rollbackHint: 'Pause campaigns or apply reversal through Ad OS change requests.',
  }),
  export_report: entry({
    actionType: 'export_report',
    agentType: 'finance',
    title: 'Export report',
    description: 'Export a finance/settlement report.',
    riskLevel: 'medium',
    requiredPayloadKeys: ['target_type'],
    requiredEvidence: ['target type', 'period'],
    predictedEffects: ['report artifact can be generated'],
    rollbackHint: 'Discard and regenerate the report.',
  }),
  generate_card_news_variants: entry({
    actionType: 'generate_card_news_variants',
    agentType: 'marketing',
    title: 'Generate card news variants',
    description: 'Generate card news variants and render images.',
    riskLevel: 'medium',
    requiredEvidence: ['source card news id', 'variant count'],
    predictedEffects: ['card news variants can be generated'],
    rollbackHint: 'Archive generated variants.',
  }),
  prompt_improvement_suggestion: entry({
    actionType: 'prompt_improvement_suggestion',
    agentType: 'system',
    title: 'Apply prompt improvement suggestion',
    description: 'Create and activate a new prompt version from learning analysis.',
    riskLevel: 'high',
    requiredPayloadKeys: ['analysis'],
    requiredEvidence: ['learning analysis', 'baseline', 'target domain'],
    predictedEffects: ['active prompt version can change'],
    rollbackHint: 'Use rollback_prompt or reactivate the previous prompt version.',
  }),
  notify_affiliate_anomaly: entry({
    actionType: 'notify_affiliate_anomaly',
    agentType: 'sales',
    title: 'Acknowledge affiliate anomaly',
    description: 'Record acknowledgement of affiliate anomaly.',
    riskLevel: 'medium',
    requiredEvidence: ['affiliate id', 'anomaly detail'],
    predictedEffects: ['audit log is recorded'],
    rollbackHint: 'Add a correcting audit note.',
  }),
} as const satisfies Record<string, ActionRegistryEntry>;

export type RegisteredActionType = keyof typeof ACTION_REGISTRY;

const AGENT_ACTION_ALIASES: Record<string, RegisteredActionType> = {
  create_rfq_proposal: 'submit_rfq_proposal',
  generate_affiliate_link: 'create_affiliate_link',
  run_ad_optimization: 'ad_optimization',
  export_settlement_report: 'export_report',
};

export function normalizeActionType(actionType: string): string {
  return AGENT_ACTION_ALIASES[actionType] ?? actionType;
}

export function getActionRegistryEntry(actionType: string): ActionRegistryEntry | null {
  const normalized = normalizeActionType(actionType);
  return ACTION_REGISTRY[actionType as RegisteredActionType] ?? ACTION_REGISTRY[normalized as RegisteredActionType] ?? null;
}

export function requiresActionApproval(actionType: string): boolean {
  return getActionRegistryEntry(actionType)?.requiresApproval ?? false;
}

export function getJarvisMutatingToolNames(): string[] {
  return Object.values(ACTION_REGISTRY)
    .filter((item) => item.exposures.includes('jarvis_tool'))
    .map((item) => item.actionType);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function payloadHasKey(payload: Record<string, unknown>, key: string): boolean {
  const value = payload[key];
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function formatEvidenceValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `${value.length} item(s)`;
  return JSON.stringify(value).slice(0, 500);
}

function inferPayloadEvidence(payload: Record<string, unknown>): DecisionEvidence[] {
  const keys = [
    'booking_id',
    'booking_ids',
    'booking_no',
    'customer_id',
    'primary_id',
    'duplicate_id',
    'package_id',
    'policy_id',
    'transaction_id',
    'affiliate_id',
    'rfq_id',
    'id',
    'status',
    'reason',
    'field',
    'key',
    'period',
    'target_type',
    'platform',
  ];
  return keys
    .filter((key) => payloadHasKey(payload, key))
    .map((key) => ({
      label: key,
      value: formatEvidenceValue(payload[key]),
      source: 'payload' as const,
    }));
}

export function dryRunAction(actionType: string, payloadInput: unknown): ActionDryRunResult {
  const entry = getActionRegistryEntry(actionType);
  const payload = isRecord(payloadInput) ? payloadInput : {};
  const generatedAt = new Date().toISOString();

  if (!entry) {
    const check: DecisionCheck = {
      id: 'registered_action',
      label: 'Action is registered',
      status: 'fail',
      detail: `No registry entry for ${actionType}`,
    };
    return {
      ok: false,
      mode: 'dry_run',
      actionType,
      riskLevel: 'critical',
      requiresApproval: true,
      checks: [check],
      evidence: [],
      blockers: [check.detail ?? 'unregistered action'],
      warnings: [],
      predictedEffects: ['unknown action refused by autopilot'],
      rollbackHint: 'Do not execute until this action is explicitly registered.',
      generatedAt,
    };
  }

  const checks: DecisionCheck[] = [
    {
      id: 'registered_action',
      label: 'Action is registered',
      status: 'pass',
      detail: entry.title,
    },
    {
      id: 'approval_required',
      label: 'Approval gate',
      status: entry.requiresApproval ? 'pass' : 'warn',
      detail: entry.requiresApproval ? 'human approval required' : 'read/write action does not require approval',
    },
  ];

  for (const key of entry.requiredPayloadKeys ?? []) {
    checks.push({
      id: `payload_${key}`,
      label: `Payload includes ${key}`,
      status: payloadHasKey(payload, key) ? 'pass' : 'fail',
      detail: payloadHasKey(payload, key) ? formatEvidenceValue(payload[key]) : 'missing',
    });
  }

  const evidence = [
    ...inferPayloadEvidence(payload),
    {
      label: 'registry_required_evidence',
      value: entry.requiredEvidence.join(', '),
      source: 'registry' as const,
    },
  ];

  const blockers = checks
    .filter((check) => check.status === 'fail')
    .map((check) => `${check.label}: ${check.detail ?? 'failed'}`);
  const warnings = checks
    .filter((check) => check.status === 'warn')
    .map((check) => `${check.label}: ${check.detail ?? 'warning'}`);

  return {
    ok: blockers.length === 0,
    mode: 'dry_run',
    actionType: entry.actionType,
    riskLevel: entry.riskLevel,
    requiresApproval: entry.requiresApproval,
    checks,
    evidence,
    blockers,
    warnings,
    predictedEffects: entry.predictedEffects,
    rollbackHint: entry.rollbackHint,
    generatedAt,
  };
}

function recommendationFromDryRun(dryRun: ActionDryRunResult): {
  recommendation: DecisionRecommendation;
  reason: string;
  confidence: number;
} {
  if (!dryRun.ok) {
    return {
      recommendation: 'reject',
      reason: `Blocked by dry-run: ${dryRun.blockers.join('; ')}`,
      confidence: 0.98,
    };
  }
  if (dryRun.riskLevel === 'critical' && dryRun.evidence.length < 2) {
    return {
      recommendation: 'hold',
      reason: 'Critical action needs stronger evidence before one-click approval.',
      confidence: 0.86,
    };
  }
  if (dryRun.warnings.length > 0) {
    return {
      recommendation: 'hold',
      reason: dryRun.warnings.join('; '),
      confidence: 0.82,
    };
  }
  return {
    recommendation: 'approve',
    reason: 'Dry-run passed and required approval/evidence gates are present.',
    confidence: dryRun.riskLevel === 'critical' ? 0.91 : 0.95,
  };
}

export function buildActionDecisionPacket(input: {
  actionType: string;
  payload: unknown;
  summary?: string | null;
}): AutopilotDecisionPacket {
  const entry = getActionRegistryEntry(input.actionType);
  const dryRun = dryRunAction(input.actionType, input.payload);
  const decision = recommendationFromDryRun(dryRun);

  return {
    actionType: dryRun.actionType,
    agentType: entry?.agentType ?? 'unknown',
    title: entry?.title ?? input.actionType,
    summary: input.summary ?? entry?.description ?? input.actionType,
    riskLevel: dryRun.riskLevel,
    requiresApproval: dryRun.requiresApproval,
    recommendation: decision.recommendation,
    recommendationReason: decision.reason,
    confidence: decision.confidence,
    requiredEvidence: entry?.requiredEvidence ?? ['registry entry'],
    evidence: dryRun.evidence,
    dryRun,
    rollbackHint: dryRun.rollbackHint,
    generatedAt: new Date().toISOString(),
  };
}
