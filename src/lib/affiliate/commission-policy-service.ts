import crypto from 'node:crypto';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';

export const SYSTEM_COMMISSION_CAP = 0.07;

export interface CommissionPolicyRow {
  id: string;
  name: string;
  trigger_type: string;
  trigger_config: Record<string, unknown> | null;
  action_type: string;
  action_config: Record<string, unknown> | null;
  target_scope: Record<string, unknown> | null;
  priority: number | null;
  policy_version: number;
  starts_at: string | null;
  ends_at: string | null;
  updated_at: string | null;
}

export interface CommissionEvaluationInput {
  productId: string;
  destination?: string;
  affiliateId: string;
  affiliateGrade: number;
  daysSinceSignup: number;
  baseRate: number;
  tierBonus: number;
  commissionBaseKrw: number;
  policies: CommissionPolicyRow[];
  computedAt?: string;
  traceId?: string;
}

export type CommissionQuote =
  | {
      status: 'CALCULATED';
      traceId: string;
      commissionBaseKrw: number;
      commissionAmountKrw: number;
      finalRate: number;
      policySetVersion: string;
      breakdown: Record<string, unknown>;
    }
  | {
      status: 'CALCULATION_HOLD';
      traceId: string;
      commissionBaseKrw: number;
      commissionAmountKrw: 0;
      finalRate: 0;
      reason: string;
      breakdown: Record<string, unknown>;
    };

function roundRate(rate: number): number {
  return Math.round(rate * 10_000) / 10_000;
}

function validRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= SYSTEM_COMMISSION_CAP;
}

function matchesScope(policy: CommissionPolicyRow, input: CommissionEvaluationInput): boolean {
  const scope = policy.target_scope;
  if (!scope || Array.isArray(scope)) return false;
  if (scope.all === true) return true;

  let hasKnownConstraint = false;
  if (typeof scope.destination === 'string') {
    hasKnownConstraint = true;
    if (input.destination !== scope.destination) return false;
  }
  if (Array.isArray(scope.product_ids)) {
    hasKnownConstraint = true;
    if (!scope.product_ids.includes(input.productId)) return false;
  }
  if (Array.isArray(scope.affiliate_ids)) {
    hasKnownConstraint = true;
    if (!scope.affiliate_ids.includes(input.affiliateId)) return false;
  }
  if (typeof scope.affiliate_grade_min === 'number') {
    hasKnownConstraint = true;
    if (input.affiliateGrade < scope.affiliate_grade_min) return false;
  }
  return hasKnownConstraint;
}

function compare(actual: unknown, operator: string, expected: unknown): boolean {
  switch (operator) {
    case '=': return actual === expected;
    case '!=': return actual !== expected;
    case '>': return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case '<': return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case '>=': return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case '<=': return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'in': return Array.isArray(expected) && expected.includes(actual);
    case 'between':
      return typeof actual === 'number' && Array.isArray(expected) && expected.length === 2
        && typeof expected[0] === 'number' && typeof expected[1] === 'number'
        && actual >= expected[0] && actual <= expected[1];
    default: return false;
  }
}

function matchesTrigger(policy: CommissionPolicyRow, input: CommissionEvaluationInput): boolean {
  if (policy.trigger_type === 'always') return true;
  if (policy.trigger_type !== 'condition') return false;
  const config = policy.trigger_config;
  if (!config || Array.isArray(config)) return false;
  const field = typeof config.field === 'string' ? config.field : '';
  const operator = typeof config.operator === 'string' ? config.operator : '';
  const allowedFields: Record<string, unknown> = {
    days_since_signup: input.daysSinceSignup,
    affiliate_grade: input.affiliateGrade,
    base_rate: input.baseRate,
    tier_bonus: input.tierBonus,
    commission_base_krw: input.commissionBaseKrw,
  };
  if (!field || !operator || !(field in allowedFields)) return false;
  return compare(allowedFields[field], operator, config.value);
}

function policySetDigest(policies: CommissionPolicyRow[]): string {
  const evidence = policies
    .map(policy => ({ id: policy.id, version: policy.policy_version, updated_at: policy.updated_at }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ system_cap: SYSTEM_COMMISSION_CAP, policies: evidence }))
    .digest('hex');
}

function hold(
  reason: string,
  commissionBaseKrw: number,
  traceId: string = crypto.randomUUID(),
): CommissionQuote {
  return {
    status: 'CALCULATION_HOLD',
    traceId,
    commissionBaseKrw,
    commissionAmountKrw: 0,
    finalRate: 0,
    reason,
    breakdown: {
      status: 'CALCULATION_HOLD',
      hold_reason: reason,
      system_cap: SYSTEM_COMMISSION_CAP,
      computed_at: new Date().toISOString(),
      trace_id: traceId,
    },
  };
}

export function evaluateCommissionPolicySet(input: CommissionEvaluationInput): CommissionQuote {
  const traceId = input.traceId || crypto.randomUUID();
  const computedAt = input.computedAt || new Date().toISOString();
  const commissionBaseKrw = Number.isSafeInteger(input.commissionBaseKrw) && input.commissionBaseKrw >= 0
    ? input.commissionBaseKrw
    : -1;
  if (commissionBaseKrw < 0) return hold('INVALID_COMMISSION_BASE', 0, traceId);
  if (!validRate(input.baseRate)) return hold('INVALID_PRODUCT_BASE_RATE', commissionBaseKrw, traceId);
  if (!validRate(input.tierBonus)) return hold('INVALID_TIER_BONUS_RATE', commissionBaseKrw, traceId);
  if (input.policies.some(policy => !Number.isInteger(policy.policy_version) || policy.policy_version <= 0)) {
    return hold('INVALID_POLICY_VERSION', commissionBaseKrw, traceId);
  }

  const campaigns: Array<{ policy_id: string; policy_version: number; name: string; rate: number; exclusive: boolean }> = [];
  const ignoredPolicies: Array<{ policy_id: string; reason: string }> = [];
  let dynamicCap = SYSTEM_COMMISSION_CAP;
  let capPolicy: { id: string; version: number; name: string } | null = null;

  for (const policy of [...input.policies].sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0))) {
    if (!matchesScope(policy, input)) {
      ignoredPolicies.push({ policy_id: policy.id, reason: 'scope_not_matched_or_malformed' });
      continue;
    }
    if (!matchesTrigger(policy, input)) {
      ignoredPolicies.push({ policy_id: policy.id, reason: 'trigger_not_matched_or_malformed' });
      continue;
    }
    const config = policy.action_config;
    if (!config || Array.isArray(config)) {
      ignoredPolicies.push({ policy_id: policy.id, reason: 'action_config_malformed' });
      continue;
    }
    if (policy.action_type === 'commission_cap') {
      const proposed = Number(config.max_rate);
      if (!validRate(proposed)) {
        ignoredPolicies.push({ policy_id: policy.id, reason: 'cap_rate_invalid' });
        continue;
      }
      if (proposed < dynamicCap) {
        dynamicCap = proposed;
        capPolicy = { id: policy.id, version: policy.policy_version, name: policy.name };
      }
      continue;
    }
    if (policy.action_type === 'commission_campaign_bonus') {
      const rate = Number(config.rate);
      if (!validRate(rate) || rate <= 0) {
        ignoredPolicies.push({ policy_id: policy.id, reason: 'campaign_rate_invalid' });
        continue;
      }
      campaigns.push({
        policy_id: policy.id,
        policy_version: policy.policy_version,
        name: policy.name,
        rate,
        exclusive: config.exclusive === true,
      });
    }
  }

  const exclusiveCampaigns = campaigns.filter(campaign => campaign.exclusive);
  const appliedCampaigns = exclusiveCampaigns.length > 0
    ? [exclusiveCampaigns.reduce((best, current) => current.rate > best.rate ? current : best)]
    : campaigns;
  const campaignRate = appliedCampaigns.reduce((sum, campaign) => sum + campaign.rate, 0);
  const rawRate = input.baseRate + input.tierBonus + campaignRate;
  const finalRate = roundRate(Math.min(rawRate, dynamicCap, SYSTEM_COMMISSION_CAP));
  const policySetVersion = policySetDigest(input.policies);
  const amount = Math.round(commissionBaseKrw * finalRate);

  return {
    status: 'CALCULATED',
    traceId,
    commissionBaseKrw,
    commissionAmountKrw: amount,
    finalRate,
    policySetVersion,
    breakdown: {
      status: 'CALCULATED',
      base: roundRate(input.baseRate),
      tier: roundRate(input.tierBonus),
      campaigns: appliedCampaigns.map(campaign => ({ ...campaign, rate: roundRate(campaign.rate) })),
      raw_total: roundRate(rawRate),
      cap: dynamicCap,
      system_cap: SYSTEM_COMMISSION_CAP,
      cap_policy: capPolicy,
      final_rate: finalRate,
      capped: rawRate > finalRate,
      commission_base_krw: commissionBaseKrw,
      commission_amount_krw: amount,
      policy_set_version: policySetVersion,
      ignored_policies: ignoredPolicies,
      computed_at: computedAt,
      trace_id: traceId,
    },
  };
}

export async function calculateCommissionQuote(input: {
  productId: string;
  affiliateId: string;
  commissionBaseKrw: number;
}): Promise<CommissionQuote> {
  const traceId = crypto.randomUUID();
  if (!isSupabaseAdminConfigured) return hold('DB_UNAVAILABLE', input.commissionBaseKrw, traceId);

  try {
    const now = new Date().toISOString();
    const [productResult, affiliateResult, policyResult] = await Promise.all([
      supabaseAdmin
        .from('travel_packages')
        .select('id, destination, affiliate_commission_rate')
        .eq('id', input.productId)
        .maybeSingle(),
      supabaseAdmin
        .from('affiliates')
        .select('id, grade, bonus_rate, created_at, is_active, partner_status')
        .eq('id', input.affiliateId)
        .maybeSingle(),
      supabaseAdmin
        .from('os_policies')
        .select('id, name, trigger_type, trigger_config, action_type, action_config, target_scope, priority, policy_version, starts_at, ends_at, updated_at')
        .eq('category', 'commission')
        .eq('is_active', true)
        .lte('starts_at', now)
        .or(`ends_at.is.null,ends_at.gte.${now}`)
        .order('priority', { ascending: true }),
    ]);

    if (productResult.error) return hold('PRODUCT_RATE_UNAVAILABLE', input.commissionBaseKrw, traceId);
    if (affiliateResult.error) return hold('AFFILIATE_RATE_UNAVAILABLE', input.commissionBaseKrw, traceId);
    if (policyResult.error) return hold('POLICY_SET_UNAVAILABLE', input.commissionBaseKrw, traceId);
    if (!productResult.data) return hold('PRODUCT_NOT_FOUND', input.commissionBaseKrw, traceId);
    if (!affiliateResult.data) return hold('AFFILIATE_NOT_FOUND', input.commissionBaseKrw, traceId);

    const product = productResult.data as unknown as Record<string, unknown>;
    const affiliate = affiliateResult.data as unknown as Record<string, unknown>;
    if (
      affiliate.is_active === false ||
      ['suspended', 'terminated'].includes(String(affiliate.partner_status))
    ) {
      return hold('AFFILIATE_RESTRICTED', input.commissionBaseKrw, traceId);
    }

    const baseRate = Number(product.affiliate_commission_rate);
    const tierBonus = Number(affiliate.bonus_rate ?? 0);
    const createdAtMs = affiliate.created_at ? new Date(String(affiliate.created_at)).getTime() : Date.now();
    return evaluateCommissionPolicySet({
      productId: input.productId,
      destination: typeof product.destination === 'string' ? product.destination : undefined,
      affiliateId: input.affiliateId,
      affiliateGrade: Math.max(1, Number(affiliate.grade || 1)),
      daysSinceSignup: Math.max(0, Math.floor((Date.now() - createdAtMs) / 86_400_000)),
      baseRate,
      tierBonus,
      commissionBaseKrw: input.commissionBaseKrw,
      policies: (policyResult.data || []) as unknown as CommissionPolicyRow[],
      traceId,
    });
  } catch {
    return hold('COMMISSION_CALCULATION_UNAVAILABLE', input.commissionBaseKrw, traceId);
  }
}
