/**
 * ══════════════════════════════════════════════════════════
 * Policy Engine — OS 전체 정책 실행 미들웨어
 * ══════════════════════════════════════════════════════════
 * 모든 API에서 활성 정책을 조회하여 가격/마일리지/알림/노출 등을 자동 적용
 */

// ── 타입 ─────────────────────────────────────────────────
export interface Policy {
  id: string;
  category: string;
  name: string;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  action_type: string;
  action_config: Record<string, unknown>;
  target_scope: Record<string, unknown>;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  priority: number;
}

interface PriceContext {
  destination?: string;
  product_id?: string;
  customer_grade?: string;
  booking_count?: number;
  pax_count?: number;
  days_before_departure?: number;
  departure_day?: string;
  base_price: number;
}

interface MileageContext {
  customer_grade?: string;
  is_birthday_month?: boolean;
  is_new_member?: boolean;
  payment_amount: number;
}

interface DisplayContext {
  remaining_seats?: number;
  days_since_created?: number;
  weekly_booking_rank?: number;
  destination?: string;
}

// ── 캐시 ─────────────────────────────────────────────────
let policyCache: Policy[] = [];
let cacheExpiry = 0;
const CACHE_TTL = 60_000; // 1분

export async function getActivePolicies(category?: string): Promise<Policy[]> {
  if (Date.now() < cacheExpiry && policyCache.length > 0) {
    return category ? policyCache.filter(p => p.category === category) : policyCache;
  }

  try {
    const { supabaseAdmin } = await import('@/lib/supabase');
    const now = new Date().toISOString();
    const { data } = await supabaseAdmin
      .from('os_policies')
      .select('*')
      .eq('is_active', true)
      .or(`ends_at.is.null,ends_at.gt.${now}`)
      .lte('starts_at', now)
      .order('priority', { ascending: true });

    policyCache = data ?? [];
    cacheExpiry = Date.now() + CACHE_TTL;
  } catch {
    // DB 연결 실패 시 캐시 유지
  }

  return category ? policyCache.filter(p => p.category === category) : policyCache;
}

export function invalidatePolicyCache(): void {
  cacheExpiry = 0;
}

// ── 조건 매칭 ────────────────────────────────────────────
function matchesScope(policy: Policy, context: Record<string, unknown>): boolean {
  const scope = policy.target_scope;
  if (scope.all === true) return true;

  if (scope.destination && context.destination !== scope.destination) return false;
  if (scope.customer_grade && context.customer_grade !== scope.customer_grade) return false;
  if (scope.product_ids && Array.isArray(scope.product_ids)) {
    if (!scope.product_ids.includes(context.product_id)) return false;
  }
  if (scope.min_price && typeof context.base_price === 'number') {
    if (context.base_price < (scope.min_price as number)) return false;
  }

  return true;
}

function matchesTrigger(policy: Policy, context: Record<string, unknown>): boolean {
  if (policy.trigger_type === 'always') return true;

  const config = policy.trigger_config;
  const field = config.field as string;
  const operator = config.operator as string;
  const value = config.value;

  if (!field || !operator) return true; // 필드 없으면 무조건 적용

  const actual = context[field];
  if (actual === undefined || actual === null) return false;

  switch (operator) {
    case '=': return actual === value;
    case '!=': return actual !== value;
    case '>': return (actual as number) > (value as number);
    case '<': return (actual as number) < (value as number);
    case '>=': return (actual as number) >= (value as number);
    case '<=': return (actual as number) <= (value as number);
    case 'in': return Array.isArray(value) && value.includes(actual);
    case 'between': return Array.isArray(value) && (actual as number) >= value[0] && (actual as number) <= value[1];
    default: return false;
  }
}

// ── 가격 엔진 ────────────────────────────────────────────
export async function applyPricePolicies(ctx: PriceContext): Promise<{
  finalPrice: number;
  appliedPolicies: { name: string; adjustment: number }[];
}> {
  const policies = await getActivePolicies('pricing');
  let price = ctx.base_price;
  const applied: { name: string; adjustment: number }[] = [];

  for (const policy of policies) {
    if (!matchesScope(policy, ctx as unknown as Record<string, unknown>)) continue;
    if (!matchesTrigger(policy, ctx as unknown as Record<string, unknown>)) continue;

    const config = policy.action_config;
    let adjustment = 0;

    switch (policy.action_type) {
      case 'price_discount_fixed':
        adjustment = -(config.amount as number || 0);
        break;
      case 'price_discount_pct':
        adjustment = -Math.round(price * (config.rate as number || 0));
        break;
      case 'price_surcharge_pct':
        adjustment = Math.round(price * (config.rate as number || 0));
        break;
    }

    if (adjustment !== 0) {
      price += adjustment;
      applied.push({ name: policy.name, adjustment });
    }
  }

  return { finalPrice: Math.max(0, price), appliedPolicies: applied };
}

// ── 마일리지 엔진 ────────────────────────────────────────
export async function applyMileagePolicies(ctx: MileageContext): Promise<{
  earnedPoints: number;
  maxUsageAmount: number;
  appliedPolicies: string[];
}> {
  const policies = await getActivePolicies('mileage');
  let rate = 0;
  let multiplier = 1;
  let grantPoints = 0;
  let maxUsageRate = 1.0;
  const applied: string[] = [];

  for (const policy of policies) {
    if (!matchesScope(policy, ctx as unknown as Record<string, unknown>)) continue;
    if (!matchesTrigger(policy, ctx as unknown as Record<string, unknown>)) continue;

    const config = policy.action_config;

    switch (policy.action_type) {
      case 'mileage_fixed':
        rate = Math.max(rate, config.rate as number || 0);
        applied.push(policy.name);
        break;
      case 'mileage_multiply':
        multiplier = Math.max(multiplier, config.multiplier as number || 1);
        applied.push(policy.name);
        break;
      case 'mileage_grant':
        grantPoints += (config.points as number || 0);
        applied.push(policy.name);
        break;
      case 'mileage_limit':
        maxUsageRate = Math.min(maxUsageRate, config.max_usage_rate as number || 1);
        applied.push(policy.name);
        break;
    }
  }

  const earnedPoints = Math.round(ctx.payment_amount * rate * multiplier) + grantPoints;
  const maxUsageAmount = Math.round(ctx.payment_amount * maxUsageRate);

  return { earnedPoints, maxUsageAmount, appliedPolicies: applied };
}

// ── 프론트 노출 엔진 ─────────────────────────────────────
export interface DisplayBadge {
  text: string;
  color: string;
  policyName: string;
}

export async function getDisplayBadges(ctx: DisplayContext): Promise<DisplayBadge[]> {
  const policies = await getActivePolicies('display');
  const badges: DisplayBadge[] = [];

  for (const policy of policies) {
    if (policy.action_type !== 'show_badge') continue;
    if (!matchesScope(policy, ctx as unknown as Record<string, unknown>)) continue;
    if (!matchesTrigger(policy, ctx as unknown as Record<string, unknown>)) continue;

    const config = policy.action_config;
    badges.push({
      text: (config.text as string) || '',
      color: (config.color as string) || 'blue',
      policyName: policy.name,
    });
  }

  return badges;
}

// ── 배너 엔진 ────────────────────────────────────────────
export interface DisplayBanner {
  text: string;
  color: string;
  position: string;
}

export async function getActiveBanners(): Promise<DisplayBanner[]> {
  const policies = await getActivePolicies('display');
  return policies
    .filter(p => p.action_type === 'show_banner')
    .map(p => ({
      text: (p.action_config.banner_text as string) || '',
      color: (p.action_config.banner_color as string) || 'red',
      position: (p.action_config.position as string) || 'top',
    }));
}

// ── 운영 정책 체크 ───────────────────────────────────────
export async function isHolidayMode(): Promise<boolean> {
  const policies = await getActivePolicies('operations');
  return policies.some(p => p.action_type === 'set_holiday');
}

export async function isBlacklisted(context: { is_blacklisted?: boolean }): Promise<{ blocked: boolean; reason: string }> {
  if (!context.is_blacklisted) return { blocked: false, reason: '' };
  const policies = await getActivePolicies('operations');
  const policy = policies.find(p => p.action_type === 'hold_approval');
  return policy
    ? { blocked: true, reason: (policy.action_config.reason as string) || '블랙리스트' }
    : { blocked: false, reason: '' };
}

// ── 예약 취소 정책 ───────────────────────────────────────
export async function getRefundRate(daysBefore: number): Promise<{ rate: number; policyName: string }> {
  const policies = await getActivePolicies('booking');
  const refundPolicies = policies.filter(p => p.action_type === 'auto_refund');

  for (const policy of refundPolicies) {
    if (matchesTrigger(policy, { days_before_departure: daysBefore })) {
      return {
        rate: (policy.action_config.refund_rate as number) || 0,
        policyName: policy.name,
      };
    }
  }

  return { rate: 0, policyName: '환불 정책 없음' };
}
