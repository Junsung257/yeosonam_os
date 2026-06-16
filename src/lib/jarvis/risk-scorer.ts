import type { AgentRiskLevel } from '@/lib/agent/envelope';

export interface ScoreRiskInput {
  message: string;
  toolPlan?: string[];
  hasMoneyMutation?: boolean;
  hasPolicyMutation?: boolean;
}

const CRITICAL_TERMS = [
  '\ud658\ubd88', // refund
  '\uacb0\uc81c \ucde8\uc18c',
  '\uce74\ub4dc \ucde8\uc18c',
  '\uc785\uae08 \ucde8\uc18c',
  '\uac15\uc81c \ucde8\uc18c',
  '\uacc4\uc88c \ubcc0\uacbd',
  '\uac1c\uc778\uc815\ubcf4 \uc0ad\uc81c',
  '\uc1a1\uae08',
  'refund',
  'payment cancel',
  'card cancel',
  'cancel payment',
  'wire transfer',
  'bank account change',
];

const INFORMATIONAL_INTENT_TERMS = [
  '\uaddc\uc815',
  '\uc815\ucc45',
  '\uc218\uc218\ub8cc',
  '\uc5bc\ub9c8',
  '\uac00\ub2a5',
  '\ub418\ub098\uc694',
  '\ub418\ub294\uc9c0',
  '\uc54c\ub824',
  '\uc548\ub0b4',
  '\ud655\uc778\ub9cc',
  '\ubb38\uc758',
  '\uc870\uac74',
  '\ubc29\ubc95',
  '\uae30\uc900',
  'policy',
  'fee',
  'how much',
  'can i',
  'possible',
];

const MUTATION_INTENT_TERMS = [
  '\ucc98\ub9ac',
  '\uc9c4\ud589',
  '\ucde8\uc18c\ud574',
  '\ud658\ubd88\ud574',
  '\ubcc0\uacbd\ud574',
  '\ubc14\uafd4',
  '\uc1a1\uae08\ud574',
  'process',
  'execute',
  'do it',
  'cancel it',
  'refund me',
];

const HIGH_TERMS = [
  '\uac00\uaca9 \ubcc0\uacbd',
  '\ud560\uc778 \uc801\uc6a9',
  '\uc218\uc218\ub8cc \ubcc0\uacbd',
  '\uc815\uc0b0',
  '\uc7ac\uace0 \ucc28\uac10',
  '\uc88c\uc11d \ud655\uc815',
  '\uc608\uc57d \ubcc0\uacbd',
  '\uc608\uc57d \ucde8\uc18c',
  '\ub0a0\uc9dc \ubcc0\uacbd',
  '\uc77c\uc815 \ubcc0\uacbd',
  '\ubcc0\uacbd\ud574',
  '\ubc14\uafd4',
  '\uc815\ucc45 \ubcc0\uacbd',
  '\uc601\ubb38 \uc774\ub984 \uc218\uc815',
  '\uc601\ubb38 \uc774\ub984',
  '\uc774\ub984 \uc218\uc815',
  '\uc774\ub984\uc774 \ud2c0',
  '\uc5ec\uad8c\ubc88\ud638 \ubcc0\uacbd',
  '\uac1c\uc778\uc815\ubcf4 \ubcc0\uacbd',
  'price change',
  'apply discount',
  'settlement',
  'deduct inventory',
  'confirm seats',
  'cancel booking',
  'change booking',
  'policy change',
];

const MEDIUM_TERMS = [
  '\uc608\uc57d \uc0c1\ud0dc',
  '\uc785\uae08 \ud655\uc778',
  '\uc785\uae08 \uacc4\uc88c',
  '\ubbf8\ub9e4\uce6d',
  '\uc5d0\uc2a4\uceec\ub808\uc774\uc158',
  '\uacc4\uc57d',
  '\ub300\uae30 \uc608\uc57d',
  '\ucef4\ud50c\ub808\uc778',
  '\ubd88\ub9cc',
  '\ucde8\uc18c \uc218\uc218\ub8cc',
  '\ud658\ubd88 \uaddc\uc815',
  '\ucd9c\ubc1c \ud655\uc815',
  '\uc0c1\ub2f4\uc6d0',
  '\uc0c1\ub2f4 \uc5f0\uacb0',
  '\ube44\uc790',
  '\uc5ec\uad8c',
  'booking status',
  'payment check',
  'unmatched payment',
  'escalation',
  'complaint',
];

const CRITICAL_TOOLS = new Set([
  'process_gdpr_request',
  'update_policy',
  'update_system_config',
  'toggle_integration',
  'resolve_fraud_case',
]);

const HIGH_TOOLS = new Set([
  'create_settlement',
  'propose_bulk_confirm_settlements',
  'match_payment',
  'update_package_field',
  'delete_package',
  'activate_policy',
  'trigger_cron_job',
  'update_booking_status',
  'update_customer',
  'update_guest_names',
]);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalize(term)));
}

function isInformationalCriticalTopic(text: string): boolean {
  return includesAny(text, INFORMATIONAL_INTENT_TERMS) && !includesAny(text, MUTATION_INTENT_TERMS);
}

function toolRisk(toolPlan: string[] = []): AgentRiskLevel | null {
  const tools = toolPlan.map((tool) => normalize(tool));
  if (tools.some((tool) => CRITICAL_TOOLS.has(tool))) return 'critical';
  if (tools.some((tool) => HIGH_TOOLS.has(tool))) return 'high';
  return null;
}

export function scoreRiskLevel(input: ScoreRiskInput): AgentRiskLevel {
  const text = normalize(`${input.message} ${(input.toolPlan ?? []).join(' ')}`);
  const plannedToolRisk = toolRisk(input.toolPlan);

  if (input.hasMoneyMutation || input.hasPolicyMutation) return 'critical';
  if (plannedToolRisk === 'critical') return 'critical';
  if (includesAny(text, CRITICAL_TERMS)) return isInformationalCriticalTopic(text) ? 'medium' : 'critical';
  if (plannedToolRisk === 'high') return 'high';
  if (includesAny(text, HIGH_TERMS)) return 'high';
  if (includesAny(text, MEDIUM_TERMS)) return 'medium';
  return 'low';
}

export function requiresApproval(riskLevel: AgentRiskLevel): boolean {
  return riskLevel === 'high' || riskLevel === 'critical';
}
