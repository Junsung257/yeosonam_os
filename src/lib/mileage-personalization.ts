/**
 * 마일리지 개인화 서비스
 *
 * 기능:
 *   - 생일월 2배 적립 (MileageContext.is_birthday_month 활용)
 *   - 3개월 미방문 고객 리액티베이션
 *   - 신규 가입 웰컴 마일리지
 *   - 첫 예약 보너스
 */
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { calcExpiresAt, getEffectiveValidityMonths } from '@/lib/mileage-expiration';

// ── 상수 ─────────────────────────────────────────────────────────────────────

const WELCOME_MILEAGE = 3000;       // 신규 가입 웰컴 마일리지
const FIRST_BOOKING_BONUS = 2000;   // 첫 예약 보너스
const REACTIVATION_MILEAGE = 5000;  // 리액티베이션 마일리지
const BIRTHDAY_MULTIPLIER = 2;      // 생일월 적립 배수

// 마일리지 메모 식별자 (중복 지급 방지 및 로그 추적용)
// NOTE: 이 값들을 변경하면 중복 지급 방지 로직(기존 트랜잭션 조회 조건)이 깨질 수 있음
const MEMO_WELCOME = '웰컴 마일리지';
const MEMO_FIRST_BOOKING = '첫 예약 보너스';
const MEMO_REACTIVATION = '리액티베이션 마일리지';

// ── 생일월 확인 ──────────────────────────────────────────────────────────────

export function isBirthdayMonth(birthDate?: string | null): boolean {
  if (!birthDate) return false;
  const now = new Date();
  const birth = new Date(birthDate);
  return now.getMonth() === birth.getMonth();
}

// ── 생일월 2배 적립 ──────────────────────────────────────────────────────────

export function getBirthdayMultiplier(birthDate?: string | null): number {
  return isBirthdayMonth(birthDate) ? BIRTHDAY_MULTIPLIER : 1;
}

// ── 웰컴 마일리지 지급 ──────────────────────────────────────────────────────

export async function awardWelcomeMileage(customerId: string, customerName?: string): Promise<{ awarded: boolean; amount: number }> {
  if (!isSupabaseConfigured) return { awarded: false, amount: 0 };

  // 이미 지급되었는지 확인
  const { data: existing } = await supabaseAdmin
    .from('mileage_transactions')
    .select('id')
    .eq('user_id', customerId)
    .eq('memo', MEMO_WELCOME)
    .limit(1);

  if (existing && existing.length > 0) {
    return { awarded: false, amount: 0 }; // 중복 지급 방지
  }

  const { data: tx, error } = await supabaseAdmin.from('mileage_transactions').insert({
    user_id: customerId,
    amount: WELCOME_MILEAGE,
    type: 'EARNED',
    margin_impact: 0,
    base_net_profit: 0,
    mileage_rate: 0,
    memo: MEMO_WELCOME,
  }).select('id').single();
  const txRow = tx as { id: string } | null;

  if (error || !txRow) return { awarded: false, amount: 0 };

  // 만료일 설정 (mileage-expiration과 동일한 로직)
  const validityMonths = await getEffectiveValidityMonths();
  const expiresAt = calcExpiresAt(new Date(), validityMonths);
  await supabaseAdmin.from('mileage_transactions').update({ expires_at: expiresAt.toISOString() }).eq('id', txRow.id);

  await supabaseAdmin.rpc('increment_customer_mileage', {
    p_user_id: customerId,
    p_amount: WELCOME_MILEAGE,
  });

  return { awarded: true, amount: WELCOME_MILEAGE };
}

// ── 첫 예약 보너스 ───────────────────────────────────────────────────────────

export async function awardFirstBookingBonus(customerId: string): Promise<{ awarded: boolean; amount: number }> {
  if (!isSupabaseConfigured) return { awarded: false, amount: 0 };

  // 첫 예약인지 확인
  const { count } = await supabaseAdmin
    .from('bookings')
    .select('*', { count: 'exact', head: true })
    .eq('customer_id', customerId);

  if (count !== 1) return { awarded: false, amount: 0 };

  // 이미 지급되었는지 확인
  const { data: existing } = await supabaseAdmin
    .from('mileage_transactions')
    .select('id')
    .eq('user_id', customerId)
    .eq('memo', MEMO_FIRST_BOOKING)
    .limit(1);

  if (existing && existing.length > 0) return { awarded: false, amount: 0 };

  const { data: tx, error } = await supabaseAdmin.from('mileage_transactions').insert({
    user_id: customerId,
    amount: FIRST_BOOKING_BONUS,
    type: 'EARNED',
    margin_impact: 0,
    base_net_profit: 0,
    mileage_rate: 0,
    memo: MEMO_FIRST_BOOKING,
  }).select('id').single();
  const txRow2 = tx as { id: string } | null;

  if (error || !txRow2) return { awarded: false, amount: 0 };

  // 만료일 설정
  const validityMonths2 = await getEffectiveValidityMonths();
  const expiresAt2 = calcExpiresAt(new Date(), validityMonths2);
  await supabaseAdmin.from('mileage_transactions').update({ expires_at: expiresAt2.toISOString() }).eq('id', txRow2.id);

  await supabaseAdmin.rpc('increment_customer_mileage', {
    p_user_id: customerId,
    p_amount: FIRST_BOOKING_BONUS,
  });

  return { awarded: true, amount: FIRST_BOOKING_BONUS };
}

// ── 리액티베이션 대상 조회 ──────────────────────────────────────────────────

export interface ReactivationTarget {
  customer_id: string;
  name: string;
  phone: string | null;
  mileage: number;
  last_booking_at: string | null;
  days_since_last_booking: number;
}

export async function findReactivationTargets(minDays: number = 90): Promise<ReactivationTarget[]> {
  if (!isSupabaseConfigured) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - minDays);

  // 최근 minDays 동안 예약이 없는 고객 중 mileage > 0 인 고객
  // (한 번이라도 예약한 적 있는 고객 중)
  const { data: customers } = await supabaseAdmin
    .from('customers')
    .select(`
      id, name, phone, mileage,
      bookings!inner (created_at)
    `)
    .gt('mileage', 0);

  if (!customers) return [];

  const targets: ReactivationTarget[] = [];

  for (const c of customers) {
    const cRow = c as { id: string; name: string; phone: string | null; mileage: number; bookings: Array<{ created_at: string }> };
    // 가장 최근 예약일
    const sortedBookings = cRow.bookings.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const lastBooking = sortedBookings[0];
    if (!lastBooking) continue;

    const lastDate = new Date(lastBooking.created_at);
    const daysSince = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSince >= minDays) {
      targets.push({
        customer_id: c.id,
        name: c.name,
        phone: c.phone,
        mileage: c.mileage,
        last_booking_at: lastBooking.created_at,
        days_since_last_booking: daysSince,
      });
    }
  }

  return targets.sort((a, b) => b.days_since_last_booking - a.days_since_last_booking);
}

// ── 리액티베이션 마일리지 지급 ──────────────────────────────────────────────

export async function awardReactivationMileage(customerId: string): Promise<{ awarded: boolean; amount: number }> {
  if (!isSupabaseConfigured) return { awarded: false, amount: 0 };

  // 90일 이내 중복 지급 방지
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  const { data: existing } = await supabaseAdmin
    .from('mileage_transactions')
    .select('id')
    .eq('user_id', customerId)
    .eq('memo', MEMO_REACTIVATION)
    .gte('created_at', cutoff.toISOString())
    .limit(1);

  if (existing && existing.length > 0) return { awarded: false, amount: 0 };

  const { data: tx, error } = await supabaseAdmin.from('mileage_transactions').insert({
    user_id: customerId,
    amount: REACTIVATION_MILEAGE,
    type: 'EARNED',
    margin_impact: 0,
    base_net_profit: 0,
    mileage_rate: 0,
    memo: MEMO_REACTIVATION,
  }).select('id').single();
  const txRow3 = tx as { id: string } | null;

  if (error || !txRow3) return { awarded: false, amount: 0 };

  // 만료일 설정
  const validityMonths3 = await getEffectiveValidityMonths();
  const expiresAt3 = calcExpiresAt(new Date(), validityMonths3);
  await supabaseAdmin.from('mileage_transactions').update({ expires_at: expiresAt3.toISOString() }).eq('id', txRow3.id);

  await supabaseAdmin.rpc('increment_customer_mileage', {
    p_user_id: customerId,
    p_amount: REACTIVATION_MILEAGE,
  });

  return { awarded: true, amount: REACTIVATION_MILEAGE };
}

// ── 리액티베이션 일괄 처리 ──────────────────────────────────────────────────

export async function processBatchReactivation(dryRun: boolean = false): Promise<{
  targets: ReactivationTarget[];
  processed: number;
  totalAwarded: number;
}> {
  const targets = await findReactivationTargets(90);

  if (dryRun || targets.length === 0) {
    return { targets, processed: 0, totalAwarded: 0 };
  }

  let processed = 0;
  let totalAwarded = 0;

  for (const target of targets) {
    const result = await awardReactivationMileage(target.customer_id);
    if (result.awarded) {
      processed++;
      totalAwarded += result.amount;
    }
  }

  return { targets, processed, totalAwarded };
}
