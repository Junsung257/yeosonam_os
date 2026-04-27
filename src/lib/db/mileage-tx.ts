/**
 * Mileage Transaction CRUD — 마일리지 적립/사용/회수 트랜잭션 로그
 *
 * supabase.ts god 모듈에서 분리 (2026-04-27).
 * 호출자는 기존 그대로 `@/lib/supabase` 에서 import 가능 (re-export 유지).
 *
 * 등급/적립률 계산 로직은 src/lib/mileage.ts (별개) 에서 담당.
 */

import { getSupabase } from '../supabase';

export interface MileageTransaction {
  id: string;
  user_id: string;
  booking_id?: string | null;
  amount: number;
  type: 'EARNED' | 'USED' | 'CLAWBACK';
  margin_impact: number;
  base_net_profit: number;
  mileage_rate: number;
  memo?: string | null;
  ref_transaction_id?: string | null;
  created_at: string;
}

export async function createMileageTransaction(
  data: Omit<MileageTransaction, 'id' | 'created_at'>
): Promise<MileageTransaction | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('mileage_transactions')
    .insert(data as never)
    .select()
    .single();
  if (error) { console.error('createMileageTransaction', error); return null; }
  return row as MileageTransaction;
}

/** 고객 마일리지 잔액 (SUM of amount) */
export async function getMileageBalance(userId: string): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  // customer_mileage_balances View 사용
  const { data } = await sb
    .from('customer_mileage_balances')
    .select('balance')
    .eq('user_id', userId)
    .single();
  return (data as { balance: number } | null)?.balance ?? 0;
}

/** booking_id 기준 EARNED 트랜잭션 조회 (CLAWBACK 대상 확인용) */
export async function getEarnedMileageByBooking(
  bookingId: string
): Promise<MileageTransaction[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('mileage_transactions')
    .select('*')
    .eq('booking_id', bookingId)
    .eq('type', 'EARNED');
  return (data ?? []) as MileageTransaction[];
}

/** 고객 마일리지 거래 내역 */
export async function getMileageHistory(
  userId: string,
  limit = 20
): Promise<MileageTransaction[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('mileage_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as MileageTransaction[];
}
