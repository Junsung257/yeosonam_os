/**
 * 마일리지 소멸 서비스
 *
 * 기능:
 *   - 적립 마일리지에 만료일 부여 (기본 적립일 + 24개월)
 *   - 만료 예정 마일리지 조회 (D-30, D-7 대상)
 *   - 자동 소멸 처리 (cron)
 *   - 최근 활동 시 자동 연장
 */
import {
  isSupabaseConfigured,
  supabaseAdmin,
  getMileageBalance,
  createMileageTransaction,
} from '@/lib/supabase';

// ── 기본 상수 ────────────────────────────────────────────────
const DEFAULT_VALIDITY_MONTHS = 24;
const DEFAULT_EXTEND_MONTHS = 12;
const DEFAULT_NOTIFY_DAYS = [30, 7] as const;

// ── 인터페이스 ────────────────────────────────────────────────

export interface ExpirationPolicy {
  id: string;
  validity_months: number;
  notify_before_days: number[];
  auto_expire: boolean;
  extend_on_activity: boolean;
  extend_months: number;
}

export interface ExpiringMileage {
  user_id: string;
  customer_name: string;
  phone: string | null;
  expiring_amount: number;
  earliest_expire_at: string;
  transaction_count: number;
}

export interface ExpireResult {
  processed_count: number;
  total_expired_amount: number;
}

// ── 소멸 정책 조회 ──────────────────────────────────────────

export async function getExpirationPolicy(): Promise<ExpirationPolicy | null> {
  if (!isSupabaseConfigured) return null;

  const { data } = await supabaseAdmin
    .from('mileage_expiration_policies')
    .select('*')
    .limit(1)
    .single();

  return data as ExpirationPolicy | null;
}

export async function getEffectiveValidityMonths(): Promise<number> {
  const policy = await getExpirationPolicy();
  return policy?.validity_months ?? DEFAULT_VALIDITY_MONTHS;
}

// ── 만료일 계산 ──────────────────────────────────────────────

export function calcExpiresAt(from: Date, validityMonths?: number): Date {
  const months = validityMonths ?? DEFAULT_VALIDITY_MONTHS;
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

// ── 소멸 예정 목록 조회 ─────────────────────────────────────

export async function getExpiringMileage(daysBefore: number = 30): Promise<ExpiringMileage[]> {
  if (!isSupabaseConfigured) return [];

  const now = new Date();
  const targetEnd = new Date(now.getTime() + daysBefore * 86400000);
  const targetStart = new Date(now.getTime() - 86400000); // 이미 지난 건 제외

  // mileage_transactions에서 expires_at이 [오늘, 오늘+daysBefore] 범위인 미소멸 EARNED 건 조회
  const { data } = await supabaseAdmin
    .from('mileage_transactions')
    .select('user_id, amount, expires_at')
    .eq('type', 'EARNED')
    .is('expired_at', null)
    .not('expires_at', 'is', null)
    .gte('expires_at', targetStart.toISOString().split('T')[0])
    .lt('expires_at', targetEnd.toISOString().split('T')[0]);

  if (!data || data.length === 0) return [];

  // 사용자별 집계
  const grouped = new Map<string, { total: number; earliest: string; count: number }>();
  for (const tx of data as Array<{ user_id: string; amount: number; expires_at: string }>) {
    const g = grouped.get(tx.user_id) ?? { total: 0, earliest: tx.expires_at, count: 0 };
    g.total += tx.amount;
    g.count++;
    if (tx.expires_at < g.earliest) g.earliest = tx.expires_at;
    grouped.set(tx.user_id, g);
  }

  // 고객명 조회 (한 번에)
  const userIds = Array.from(grouped.keys());
  const { data: customers } = await supabaseAdmin
    .from('customers')
    .select('id, name, phone')
    .in('id', userIds);
  const customerMap = new Map((customers ?? []).map((c: any) => [c.id, { name: c.name || '', phone: c.phone || null }]));

  return Array.from(grouped.entries()).map(([userId, g]) => ({
    user_id: userId,
    customer_name: customerMap.get(userId)?.name ?? '',
    phone: customerMap.get(userId)?.phone ?? null,
    expiring_amount: g.total,
    earliest_expire_at: g.earliest,
    transaction_count: g.count,
  })) as ExpiringMileage[];
}

// ── 자동 소멸 실행 ───────────────────────────────────────────

export async function expireMileage(batchSize: number = 100): Promise<ExpireResult> {
  if (!isSupabaseConfigured) {
    console.log('[MileageExpiration Mock] 소멸 처리 실행');
    return { processed_count: 0, total_expired_amount: 0 };
  }

  const { data, error } = await supabaseAdmin.rpc('expire_mileage_batch', {
    p_batch_size: batchSize,
  });

  if (error) {
    console.error('[MileageExpiration] 소멸 처리 실패:', error);
    return { processed_count: 0, total_expired_amount: 0 };
  }

  const result = data as unknown as ExpireResult;
  if (result.processed_count > 0) {
    console.log(
      `[MileageExpiration] ${result.processed_count}건 처리, ` +
      `총 ${result.total_expired_amount.toLocaleString()}P 소멸`
    );
  }

  return result;
}

// ── EARNED 트랜잭션에 만료일 설정 ──────────────────────────

export async function setExpiresOnEarnedTransaction(
  transactionId: string,
  expiresAt: Date,
): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseAdmin
    .from('mileage_transactions')
    .update({ expires_at: expiresAt.toISOString() })
    .eq('id', transactionId);
}

// ── customers.mileage_expire_at 갱신 ─────────────────────────

export async function refreshCustomerExpireAt(userId: string): Promise<void> {
  if (!isSupabaseConfigured) return;

  // 가장 늦은 만료일 계산 (모든 EARNED 중 max expires_at)
  const { data } = await supabaseAdmin
    .from('mileage_transactions')
    .select('expires_at')
    .eq('user_id', userId)
    .eq('type', 'EARNED')
    .gt('amount', 0)
    .not('expires_at', 'is', null)
    .order('expires_at', { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    const latestExpire = (data[0] as { expires_at: string }).expires_at;
    await supabaseAdmin
      .from('customers')
      .update({ mileage_expire_at: latestExpire })
      .eq('id', userId);
  }
}

// ── 최근 활동 시 자동 연장 ──────────────────────────────────

export async function extendMileageIfActive(
  userId: string,
  extendMonths?: number,
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const policy = await getExpirationPolicy();
  if (!policy || !policy.extend_on_activity) return false;

  const months = extendMonths ?? policy.extend_months ?? DEFAULT_EXTEND_MONTHS;

  // 최근 1년 내 적립/사용 이력 확인
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const { count } = await supabaseAdmin
    .from('mileage_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('type', ['EARNED', 'USED'])
    .gte('created_at', oneYearAgo.toISOString());

  if (count === 0 || count === null) return false;

  // 모든 EARNED 트랜잭션의 만료일을 연장
  const { error } = await supabaseAdmin.rpc('extend_mileage_expiry', {
    p_user_id: userId,
    p_extra_months: months,
  });

  if (error) {
    console.error('[MileageExpiration] 연장 실패:', error);
    return false;
  }

  await refreshCustomerExpireAt(userId);
  console.log(`[MileageExpiration] ${userId} 마일리지 ${months}개월 연장 완료`);
  return true;
}
