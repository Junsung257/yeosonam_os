/**
 * 서버 전용 마일리지 적립 서비스
 * API Route에서 import해서 사용
 *
 * 설계 원칙:
 *  - [원가 불변 원칙] 마일리지 사용 시 원가(랜드사 수취액)는 절대 건드리지 않는다.
 *    마일리지 사용분만큼 대표 마진(판매가 - 원가)에서 차감된다.
 *  - [어뷰징 방어] 결제 취소/환불 시 해당 booking_id의 EARNED 마일리지를
 *    즉시 CLAWBACK 처리한다. 이미 USED된 마일리지보다 회수 가능 잔액이
 *    부족할 경우 가용 잔액까지만 회수한다.
 *  - [net_profit 기반 적립] Step 1 ad_conversion_logs.net_profit
 *    (판매가 - 원가 - allocated_ad_spend)의 일정 비율(기본 5%)을 적립한다.
 *
 * 환경변수:
 *   MILEAGE_EARN_RATE_PCT   기본 5 (%)
 *   MILEAGE_MIN_EARN        기본 100 (최소 적립 단위, 원)
 *   MILEAGE_MAX_USE_PCT     기본 30 (최대 사용 한도 = 결제금액의 30%)
 */

import {
  isSupabaseConfigured,
  getMileageBalance,
  createMileageTransaction,
  getEarnedMileageByBooking,
  type MileageTransaction,
} from '@/lib/supabase';

// ── 설정 상수 ────────────────────────────────────────────────

const EARN_RATE_PCT  = parseFloat(process.env.MILEAGE_EARN_RATE_PCT ?? '5');
const MIN_EARN       = parseInt(process.env.MILEAGE_MIN_EARN ?? '100');
const MAX_USE_PCT    = parseFloat(process.env.MILEAGE_MAX_USE_PCT ?? '30');

// ── 인터페이스 ────────────────────────────────────────────────

export interface EarnResult {
  earned: number;           // 실제 적립된 마일리지 (원)
  base_net_profit: number;  // 기준이 된 net_profit
  rate: number;             // 적립률 (%)
  transaction_id: string;
}

export interface UseResult {
  used: number;             // 실제 사용된 마일리지 (원)
  margin_impact: number;    // 대표 마진 차감분 (음수)
  remaining_balance: number;
  transaction_id: string;
}

export interface ClawbackResult {
  clawback_amount: number;  // 실제 회수된 마일리지
  original_earned: number;  // 원래 적립 금액
  partial: boolean;         // 부분 회수 여부 (이미 사용된 경우)
  transaction_id: string;
}

// ═══════════════════════════════════════════════════════════════
// 1. 마일리지 적립 (EARNED) — 전환(결제완료) 시 자동 호출
// ═══════════════════════════════════════════════════════════════

/**
 * net_profit의 EARN_RATE_PCT%를 마일리지로 적립한다.
 *
 * 호출 시점: /api/tracking conversion 이벤트 처리 후, 또는
 *            booking status → COMPLETED 전환 시
 *
 * @param userId        고객 UUID
 * @param bookingId     예약 ID (중복 적립 방지용)
 * @param netProfit     순수익 (판매가 - 원가 - 광고비)
 * @param sellingPrice  판매가 (로그용)
 */
export async function earnMileage(params: {
  userId: string;
  bookingId: string;
  netProfit: number;
  sellingPrice: number;
}): Promise<EarnResult | null> {
  const { userId, bookingId, netProfit, sellingPrice } = params;

  // net_profit이 0 이하면 적립 불가 (손해 구조에서 마일리지 지급 안 함)
  if (netProfit <= 0) {
    console.log(`[MileageService] 적립 스킵 — net_profit=${netProfit} (0 이하)`);
    return null;
  }

  const earnAmount = Math.max(MIN_EARN, Math.floor(netProfit * EARN_RATE_PCT / 100));

  const memo = [
    `결제 완료 적립`,
    `판매가: ₩${sellingPrice.toLocaleString('ko-KR')}`,
    `순수익: ₩${netProfit.toLocaleString('ko-KR')}`,
    `적립률: ${EARN_RATE_PCT}%`,
  ].join(' | ');

  if (!isSupabaseConfigured) {
    console.log(`[MileageService Mock] 적립: ₩${earnAmount} → user ${userId}`);
    return {
      earned: earnAmount,
      base_net_profit: netProfit,
      rate: EARN_RATE_PCT,
      transaction_id: `mock-earn-${Date.now()}`,
    };
  }

  const tx = await createMileageTransaction({
    user_id: userId,
    booking_id: bookingId,
    amount: earnAmount,
    type: 'EARNED',
    margin_impact: 0,       // 적립은 마진 변동 없음
    base_net_profit: netProfit,
    mileage_rate: EARN_RATE_PCT,
    memo,
  });

  if (!tx) return null;

  return {
    earned: earnAmount,
    base_net_profit: netProfit,
    rate: EARN_RATE_PCT,
    transaction_id: tx.id,
  };
}

// ═══════════════════════════════════════════════════════════════
// 2. 마일리지 사용 (USED) — 재방문 결제 시 호출
//    [원가 불변] 대표 마진에서 사용분만큼 차감
// ═══════════════════════════════════════════════════════════════

/**
 * 마일리지 사용 처리.
 *
 * 회계 처리 설계:
 *   - 고객 결제금액: 판매가 - 사용마일리지
 *   - 원가(랜드사 수취액): 변동 없음
 *   - 대표 마진 = (판매가 - 사용마일리지) - 원가
 *              = 기존마진 - 사용마일리지
 *   → margin_impact = -usedAmount (대표 마진 차감분)
 *
 * @param userId       고객 UUID
 * @param bookingId    신규 예약 ID
 * @param useAmount    사용 요청 마일리지 (원)
 * @param sellingPrice 결제 전 원래 판매가 (최대 사용 한도 검증용)
 */
export async function useMileage(params: {
  userId: string;
  bookingId: string;
  useAmount: number;
  sellingPrice: number;
}): Promise<UseResult | null> {
  const { userId, bookingId, useAmount, sellingPrice } = params;

  if (useAmount <= 0) {
    console.log('[MileageService] 사용 금액이 0 이하입니다');
    return null;
  }

  // ── 최대 사용 한도 검증 (판매가의 MAX_USE_PCT%) ──────────────
  const maxAllowed = Math.floor(sellingPrice * MAX_USE_PCT / 100);
  const requestedUse = Math.min(useAmount, maxAllowed);

  if (!isSupabaseConfigured) {
    console.log(`[MileageService Mock] 사용: ₩${requestedUse} → user ${userId}`);
    return {
      used: requestedUse,
      margin_impact: -requestedUse,
      remaining_balance: 0,
      transaction_id: `mock-use-${Date.now()}`,
    };
  }

  // ── 잔액 확인 ────────────────────────────────────────────────
  const balance = await getMileageBalance(userId);
  if (balance < requestedUse) {
    console.log(`[MileageService] 잔액 부족 — 보유: ₩${balance}, 요청: ₩${requestedUse}`);
    return null;
  }

  const memo = [
    `마일리지 사용`,
    `판매가: ₩${sellingPrice.toLocaleString('ko-KR')}`,
    `사용액: ₩${requestedUse.toLocaleString('ko-KR')}`,
    `[원가 불변] 대표 마진 차감`,
  ].join(' | ');

  const tx = await createMileageTransaction({
    user_id: userId,
    booking_id: bookingId,
    amount: -requestedUse,         // 음수 — 잔액 차감
    type: 'USED',
    margin_impact: -requestedUse,  // 대표 마진 차감분 (음수)
    base_net_profit: 0,
    mileage_rate: 0,
    memo,
  });

  if (!tx) return null;

  const newBalance = balance - requestedUse;

  return {
    used: requestedUse,
    margin_impact: -requestedUse,
    remaining_balance: newBalance,
    transaction_id: tx.id,
  };
}

// ═══════════════════════════════════════════════════════════════
// 3. 마일리지 회수 (CLAWBACK) — 결제 취소/환불 시 자동 호출
//    [어뷰징 방어] 필수 로직
// ═══════════════════════════════════════════════════════════════

/**
 * 결제 취소/환불 시 해당 booking_id의 EARNED 마일리지를 회수한다.
 *
 * 처리 흐름:
 *   1. booking_id로 EARNED 트랜잭션 조회
 *   2. 현재 잔액 확인 (이미 USED된 경우 가용 잔액만 회수)
 *   3. CLAWBACK 트랜잭션 생성 (amount = 음수)
 *   4. 부분 회수 시 partial=true 반환 (어드민 수동 처리 안내)
 *
 * @param userId    고객 UUID
 * @param bookingId 취소/환불된 예약 ID
 */
export async function clawbackMileage(params: {
  userId: string;
  bookingId: string;
  reason?: string;
}): Promise<ClawbackResult | null> {
  const { userId, bookingId, reason } = params;

  if (!isSupabaseConfigured) {
    console.log(`[MileageService Mock] 회수 처리 — booking ${bookingId}`);
    return {
      clawback_amount: 0,
      original_earned: 0,
      partial: false,
      transaction_id: `mock-clawback-${Date.now()}`,
    };
  }

  // ── 해당 booking의 EARNED 트랜잭션 조회 ────────────────────
  const earnedTxs = await getEarnedMileageByBooking(bookingId);
  if (earnedTxs.length === 0) {
    console.log(`[MileageService] 회수 대상 없음 — booking ${bookingId}에 EARNED 내역 없음`);
    return null;
  }

  const originalEarned = earnedTxs.reduce((sum, tx) => sum + tx.amount, 0);
  const earnedTxId = earnedTxs[0].id; // 첫 번째 EARNED 트랜잭션 참조

  // ── 현재 잔액 확인 (이미 USED된 경우 가용분만 회수) ────────
  const currentBalance = await getMileageBalance(userId);
  const clawbackAmount = Math.min(originalEarned, Math.max(0, currentBalance));
  const isPartial = clawbackAmount < originalEarned;

  if (clawbackAmount === 0) {
    console.warn(
      `[MileageService] 회수 불가 — 잔액 없음 (already used). ` +
      `booking=${bookingId}, earned=${originalEarned}`
    );
    // 잔액이 0이어도 CLAWBACK 기록은 남긴다 (어드민 추적용)
  }

  const memo = [
    `결제 취소/환불 마일리지 회수`,
    reason ? `사유: ${reason}` : '',
    `원 적립액: ₩${originalEarned.toLocaleString('ko-KR')}`,
    `실 회수액: ₩${clawbackAmount.toLocaleString('ko-KR')}`,
    isPartial ? `[부분 회수] 이미 사용된 마일리지 ₩${(originalEarned - clawbackAmount).toLocaleString('ko-KR')} 어드민 확인 필요` : '',
  ].filter(Boolean).join(' | ');

  const tx = await createMileageTransaction({
    user_id: userId,
    booking_id: bookingId,
    amount: -clawbackAmount,       // 음수 — 잔액에서 차감
    type: 'CLAWBACK',
    margin_impact: 0,
    base_net_profit: 0,
    mileage_rate: 0,
    memo,
    ref_transaction_id: earnedTxId,
  });

  if (!tx) return null;

  if (isPartial) {
    console.warn(
      `[MileageService] 부분 회수 발생! ` +
      `booking=${bookingId} / 원 적립=${originalEarned} / 회수=${clawbackAmount} / 미회수=${originalEarned - clawbackAmount}`
    );
  }

  return {
    clawback_amount: clawbackAmount,
    original_earned: originalEarned,
    partial: isPartial,
    transaction_id: tx.id,
  };
}

// ── 마일리지 잔액 조회 (래퍼) ────────────────────────────────

export async function getBalance(userId: string): Promise<number> {
  if (!isSupabaseConfigured) return 0;
  return getMileageBalance(userId);
}

// ── 최대 사용 가능 마일리지 계산 ────────────────────────────

export function calcMaxUsable(balance: number, sellingPrice: number): number {
  const maxByRate = Math.floor(sellingPrice * MAX_USE_PCT / 100);
  return Math.min(balance, maxByRate);
}

// ═══════════════════════════════════════════════════════════════
// 4. CRM 연동: 예약 입금 매칭 시 등급 기반 마일리지 자동 적립
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase';
import { calcMileageEarned } from '@/lib/mileage';

/**
 * 입금 매칭(bank_transactions PATCH action='match') 완료 시 자동 적립
 * 고객 등급별 적립률: 신규/일반=1%, 우수=3%, VVIP=5%
 */
export async function creditMileageForBooking(
  bookingId: string,
  txAmount: number,
  transactionId?: string,
) {
  try {
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('lead_customer_id')
      .eq('id', bookingId)
      .single();

    const customerId = (booking as any)?.lead_customer_id;
    if (!customerId) return;

    const { data: cust } = await supabaseAdmin
      .from('customers')
      .select('grade, mileage, total_spent')
      .eq('id', customerId)
      .single();

    if (!cust) return;

    const grade        = (cust as any).grade      ?? '신규';
    const currentMile  = (cust as any).mileage     ?? 0;
    const currentSpent = (cust as any).total_spent ?? 0;

    const earned     = calcMileageEarned(txAmount, grade);
    const newMileage = currentMile  + earned;
    const newSpent   = currentSpent + txAmount;

    // total_spent 갱신 → DB 트리거가 grade 자동 재계산
    await supabaseAdmin
      .from('customers')
      .update({ mileage: newMileage, total_spent: newSpent, updated_at: new Date().toISOString() })
      .eq('id', customerId);

    await supabaseAdmin.from('mileage_history').insert([{
      customer_id:    customerId,
      delta:          earned,
      reason:         '예약 적립',
      booking_id:     bookingId,
      transaction_id: transactionId ?? null,
      balance_after:  newMileage,
    }]);

    console.log(`[CRM마일리지] ${grade} +${earned.toLocaleString()}P (잔액 ${newMileage.toLocaleString()}P)`);
  } catch (e) {
    console.warn('[CRM마일리지 적립 실패]', e);
  }
}
