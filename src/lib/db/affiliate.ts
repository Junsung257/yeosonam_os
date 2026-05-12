/**
 * Affiliate ERP — 어필리에이트 / 인플루언서 관리
 *
 * supabase.ts god 모듈에서 분리 (2026-04-27).
 * 호출자는 기존 그대로 `@/lib/supabase` 에서 import 가능 (re-export 유지).
 *
 * 정산 로직은 src/lib/affiliate/settlement-calc.ts (별개 모듈) 에 있음.
 */

import { supabase } from '../supabase';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';

// ─── 타입 ────────────────────────────────────────────────────

export interface Affiliate {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  referral_code: string;
  grade: number;
  bonus_rate: number;
  payout_type: 'PERSONAL' | 'BUSINESS';
  booking_count: number;
  total_commission: number;
  memo?: string;
}

export interface MonthlyChartData {
  month: string;           // "2026-01"
  direct_sales: number;
  affiliate_sales: number;
  direct_margin: number;
  affiliate_margin: number;
  total_commission: number;
}

// ─── 어필리에이트 CRUD ───────────────────────────────────────

/** 어필리에이트 전체 목록 조회 */
export async function getAffiliates(): Promise<Affiliate[]> {
  try {
    const { data, error } = await supabase
      .from('affiliates')
      .select('id, name, phone, email, referral_code, grade, bonus_rate, payout_type, booking_count, total_commission, memo')
      .order('grade', { ascending: false });
    if (error) throw error;
    return (data || []) as Affiliate[];
  } catch (error) {
    console.error('어필리에이트 목록 조회 실패:', error);
    return [];
  }
}

/** 추천코드로 어필리에이트 단건 조회 */
export async function getAffiliateByCode(referralCode: string): Promise<Affiliate | null> {
  try {
    const code = normalizeAffiliateReferralCode(referralCode);
    if (!code) return null;
    const { data, error } = await supabase
      .from('affiliates')
      .select('id, name, phone, email, referral_code, grade, bonus_rate, payout_type, booking_count, total_commission, memo')
      .eq('referral_code', code)
      .single();
    if (error) throw error;
    return data as Affiliate;
  } catch {
    return null;
  }
}

// ─── 대시보드 통계 ───────────────────────────────────────────

/** 대시보드 차트용 월별 직판/인플 통계 (최근 N개월) — 단일 쿼리 */
export async function getDashboardStatsV2(months = 6): Promise<MonthlyChartData[]> {
  try {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const start = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-01`;

    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('total_price, margin, influencer_commission, booking_type, departure_date')
      .gte('departure_date', start)
      .lte('departure_date', end)
      .neq('status', 'cancelled')
      .or('is_deleted.is.null,is_deleted.eq.false');

    if (error) throw error;

    // 결과 슬롯 초기화
    const monthMap = new Map<string, MonthlyChartData>();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthMap.set(label, { month: label, direct_sales: 0, affiliate_sales: 0, direct_margin: 0, affiliate_margin: 0, total_commission: 0 });
    }

    // 단일 루프로 집계
    for (const b of (bookings || []) as { total_price?: number; margin?: number; influencer_commission?: number; booking_type?: string; departure_date?: string }[]) {
      if (!b.departure_date) continue;
      const slot = monthMap.get(b.departure_date.slice(0, 7));
      if (!slot) continue;
      if (b.booking_type === 'AFFILIATE') {
        slot.affiliate_sales += b.total_price || 0;
        slot.affiliate_margin += b.margin || 0;
        slot.total_commission += b.influencer_commission || 0;
      } else {
        slot.direct_sales += b.total_price || 0;
        slot.direct_margin += b.margin || 0;
      }
    }

    return Array.from(monthMap.values());
  } catch (error) {
    console.error('차트 통계 조회 실패:', error);
    return [];
  }
}
