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

// ─────────────────────────────────────────────────────────
// 어필리에이터 커미션 엔진 (가산식 + 글로벌 캡)
// ─────────────────────────────────────────────────────────
//
// 최종_커미션율 = product.affiliate_commission_rate
//              + affiliates.bonus_rate (등급 보너스)
//              + Σ commission_campaign_bonus (활성 캠페인)
//              ↓ min( commission_cap )
//
// action_type:
//   - commission_campaign_bonus  { rate: 0.01 }   ← 가산
//   - commission_cap             { max_rate: 0.07 } ← 최종 캡(필터링·하한)
//
// scope (target_scope):
//   - { all: true }
//   - { product_ids: [...] }       ← 특정 상품에만
//   - { destination: '다낭' }       ← 특정 목적지에만
//   - { affiliate_grade_min: 3 }   ← 골드 이상에만
//   - { affiliate_ids: [...] }     ← 특정 어필리에이터에만
//
// flag (action_config):
//   - exclusive: true              ← 이 캠페인만 단독 적용 (다른 캠페인 무시)

export interface CommissionContext {
  product_id?: string;
  destination?: string;
  affiliate_id?: string;
  affiliate_grade?: number;
  days_since_signup?: number;
  base_rate: number;          // products.affiliate_commission_rate
  tier_bonus: number;         // affiliates.bonus_rate
}

export interface CommissionCampaign {
  policy_id: string;
  name: string;
  rate: number;
  exclusive: boolean;
}

export interface CommissionBreakdown {
  base: number;
  tier: number;
  campaigns: CommissionCampaign[];
  raw_total: number;
  cap: number | null;
  cap_policy_name: string | null;
  final_rate: number;
  capped: boolean;
  computed_at: string;
}

function matchesAffiliateScope(policy: Policy, ctx: CommissionContext): boolean {
  const scope = policy.target_scope || {};
  if (scope.all === true) return true;

  if (scope.destination && ctx.destination !== scope.destination) return false;

  if (scope.product_ids && Array.isArray(scope.product_ids)) {
    if (!ctx.product_id || !scope.product_ids.includes(ctx.product_id)) return false;
  }
  if (scope.affiliate_ids && Array.isArray(scope.affiliate_ids)) {
    if (!ctx.affiliate_id || !scope.affiliate_ids.includes(ctx.affiliate_id)) return false;
  }
  if (typeof scope.affiliate_grade_min === 'number') {
    // 등급 미부여(null/undefined) 어필리에이터는 최저(1)로 간주.
    // affiliate_grade_min=2(실버) 이상 정책은 신규 미심사 어필리에이터에 적용되지 않음.
    const grade = typeof ctx.affiliate_grade === 'number' && ctx.affiliate_grade > 0
      ? ctx.affiliate_grade
      : 1;
    if (grade < (scope.affiliate_grade_min as number)) return false;
  }

  return true;
}

export async function applyCommissionPolicies(ctx: CommissionContext): Promise<CommissionBreakdown> {
  const policies = await getActivePolicies('commission');
  const base = Math.max(0, ctx.base_rate || 0);
  const tier = Math.max(0, ctx.tier_bonus || 0);

  const eligibleCampaigns: CommissionCampaign[] = [];
  let cap: number | null = null;
  let capName: string | null = null;

  for (const p of policies) {
    if (!matchesAffiliateScope(p, ctx)) continue;
    if (!matchesTrigger(p, ctx as unknown as Record<string, unknown>)) continue;

    const cfg = p.action_config || {};

    if (p.action_type === 'commission_cap') {
      const r = Number(cfg.max_rate);
      if (Number.isFinite(r) && r >= 0) {
        if (cap === null || r < cap) {
          cap = r;
          capName = p.name;
        }
      }
    } else if (p.action_type === 'commission_campaign_bonus') {
      const rate = Number(cfg.rate);
      if (!Number.isFinite(rate) || rate <= 0) continue;
      eligibleCampaigns.push({
        policy_id: p.id,
        name: p.name,
        rate,
        exclusive: cfg.exclusive === true,
      });
    }
  }

  // exclusive 캠페인 우선: 하나라도 있으면 가장 높은 rate 단독 적용
  let campaigns: CommissionCampaign[];
  const exclusives = eligibleCampaigns.filter(c => c.exclusive);
  if (exclusives.length > 0) {
    const top = exclusives.reduce((a, b) => (b.rate > a.rate ? b : a));
    campaigns = [top];
  } else {
    campaigns = eligibleCampaigns;
  }

  const campaignSum = campaigns.reduce((s, c) => s + c.rate, 0);
  const rawTotal = base + tier + campaignSum;
  const finalRate = cap !== null ? Math.min(rawTotal, cap) : rawTotal;
  const capped = cap !== null && rawTotal > cap;

  // 소수 4자리로 라운드 (NUMERIC(5,4) 호환)
  const round4 = (n: number) => Math.round(n * 10000) / 10000;

  return {
    base: round4(base),
    tier: round4(tier),
    campaigns: campaigns.map(c => ({ ...c, rate: round4(c.rate) })),
    raw_total: round4(rawTotal),
    cap,
    cap_policy_name: capName,
    final_rate: round4(finalRate),
    capped,
    computed_at: new Date().toISOString(),
  };
}

// 어드민 미리보기용: 활성 어필리에이터 N명 평균 커미션 변화 시뮬레이션 — 향후 확장
export function summarizeBreakdown(b: CommissionBreakdown): string {
  const parts = [
    `상품 ${(b.base * 100).toFixed(2)}%`,
    `등급 +${(b.tier * 100).toFixed(2)}%`,
  ];
  if (b.campaigns.length > 0) {
    const cs = b.campaigns.map(c => `${c.name} +${(c.rate * 100).toFixed(2)}%`).join(', ');
    parts.push(`캠페인 [${cs}]`);
  }
  parts.push(`= ${(b.final_rate * 100).toFixed(2)}%`);
  if (b.capped && b.cap_policy_name) parts.push(`(${b.cap_policy_name} ${(b.cap! * 100).toFixed(2)}% 적용)`);
  return parts.join(' ');
}
