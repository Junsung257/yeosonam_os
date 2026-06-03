/**
 * settlement-calc 단위 테스트
 *
 * 재무 직결 — 정산 기안 크론(매월 1일 02:00)이 사용. 회귀 시 정산 사고.
 *
 * 커버:
 *   - resolvePreviousPeriod: 이전 달 계산 (year rollover, 윤년, 월말 경계)
 *   - computeSettlementDraft: 순수 계산 함수 전 영역
 *
 * 비커버 (DB 모킹 필요):
 *   - calculateDraftForAffiliate (Promise.all 병렬 쿼리 결합)
 *   - applySettlementApproval
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePreviousPeriod, computeSettlementDraft } from './settlement-calc';
import type { BookingForSettlement, PendingAdjustment } from './settlement-calc';

// ─── 헬퍼 ─────────────────────────────────────────────────────────────

function booking(overrides: Partial<BookingForSettlement> = {}): BookingForSettlement {
  return {
    id: `bk-${Math.random().toString(36).slice(2, 6)}`,
    influencer_commission: 100_000,
    return_date: '2026-05-15',
    self_referral_flag: false,
    ...overrides,
  };
}

const baseAffiliate = { id: 'aff-1', name: '테스트제휴사', payout_type: 'CORPORATE' };
const personalAffiliate = { id: 'aff-2', name: '개인제휴사', payout_type: 'PERSONAL' };

// ─── resolvePreviousPeriod (기존 유지) ───────────────────────────────

describe('resolvePreviousPeriod', () => {
  it('2026-04-15 → 2026-03 기간 반환', () => {
    const r = resolvePreviousPeriod(new Date('2026-04-15T10:00:00Z'));
    expect(r.period).toBe('2026-03');
    expect(r.periodStart).toBe('2026-03-01');
    expect(r.periodEnd).toBe('2026-03-31');
  });

  it('1월 → 작년 12월 (year rollover)', () => {
    const r = resolvePreviousPeriod(new Date('2026-01-05T10:00:00Z'));
    expect(r.period).toBe('2025-12');
    expect(r.periodStart).toBe('2025-12-01');
    expect(r.periodEnd).toBe('2025-12-31');
  });

  it('3월 → 2월 마지막 날 (윤년 2024)', () => {
    const r = resolvePreviousPeriod(new Date('2024-03-10T10:00:00Z'));
    expect(r.period).toBe('2024-02');
    expect(r.periodEnd).toBe('2024-02-29'); // 윤년
  });

  it('3월 → 2월 마지막 날 (평년 2025)', () => {
    const r = resolvePreviousPeriod(new Date('2025-03-10T10:00:00Z'));
    expect(r.period).toBe('2025-02');
    expect(r.periodEnd).toBe('2025-02-28');
  });

  it('5월 → 4월 마지막 날 30일', () => {
    const r = resolvePreviousPeriod(new Date('2026-05-01T10:00:00Z'));
    expect(r.period).toBe('2026-04');
    expect(r.periodEnd).toBe('2026-04-30');
  });

  it('todayIso는 입력 날짜의 YYYY-MM-DD', () => {
    const r = resolvePreviousPeriod(new Date('2026-04-27T15:30:00Z'));
    expect(r.todayIso).toBe('2026-04-27');
  });

  it('period는 zero-padded MM 포맷', () => {
    const r = resolvePreviousPeriod(new Date('2026-02-15T10:00:00Z'));
    expect(r.period).toBe('2026-01'); // 01, not 1
  });

  it('인자 없이 호출하면 현재 시각 기준', () => {
    const r = resolvePreviousPeriod();
    // 형식 검증만 (값은 시간 의존)
    expect(r.period).toMatch(/^\d{4}-\d{2}$/);
    expect(r.periodStart).toMatch(/^\d{4}-\d{2}-01$/);
    expect(r.periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('calculateDraftForAffiliate DB query contract', () => {
  it('selects settlement candidates by return_date period, not departure_date', () => {
    const file = readFileSync(join(process.cwd(), 'src/lib/affiliate/settlement-calc.ts'), 'utf8');
    const bookingsQueryStart = file.indexOf(".from('bookings')");
    const bookingsQuery = file.slice(bookingsQueryStart, file.indexOf('supabaseAdmin', bookingsQueryStart + 1));

    expect(bookingsQuery).toContain(".gte('return_date', periodStart)");
    expect(bookingsQuery).toContain(".lte('return_date', periodEnd)");
    expect(bookingsQuery).not.toContain(".gte('departure_date', periodStart)");
    expect(bookingsQuery).not.toContain(".lte('departure_date', periodEnd)");
  });
});

// ─── computeSettlementDraft ──────────────────────────────────────────

describe('computeSettlementDraft — 정산 기안 순수 계산', () => {
  it('자격 충족 (3건 + 30만원) → qualified=true, final_payout > 0', () => {
    const bookings = [
      booking({ influencer_commission: 100_000 }),
      booking({ influencer_commission: 100_000 }),
      booking({ influencer_commission: 100_000 }),
    ];
    const draft = computeSettlementDraft(bookings, 0, [], baseAffiliate, '2026-05', '2026-05-20');
    expect(draft.qualified).toBe(true);
    expect(draft.qualified_booking_count).toBe(3);
    expect(draft.total_amount).toBe(300_000);
    expect(draft.final_payout).toBeGreaterThan(0);
  });

  it('자격 미달 (2건) → qualified=false, final_payout=0, carryover 누적', () => {
    const bookings = [
      booking({ influencer_commission: 100_000 }),
      booking({ influencer_commission: 100_000 }),
    ];
    const draft = computeSettlementDraft(bookings, 50_000, [], baseAffiliate, '2026-05', '2026-05-20');
    expect(draft.qualified).toBe(false);
    expect(draft.qualified_booking_count).toBe(2);
    expect(draft.final_payout).toBe(0);
    // carryover = prevCarryover + totalAmount (200_000 + 50_000)
    expect(draft.carryover_balance).toBe(250_000);
  });

  it('자격 미달 (금액 부족) → qualified=false', () => {
    const bookings = [
      booking({ influencer_commission: 10_000 }),
      booking({ influencer_commission: 10_000 }),
      booking({ influencer_commission: 10_000 }),
      booking({ influencer_commission: 10_000 }),
    ];
    const draft = computeSettlementDraft(bookings, 0, [], baseAffiliate, '2026-05', '2026-05-20');
    expect(draft.qualified).toBe(false);
    expect(draft.qualified_booking_count).toBe(4); // 건수는 충족
    expect(draft.total_amount).toBe(40_000); // 금액 미달
    expect(draft.final_payout).toBe(0);
  });

  it('PERSONAL 제휴사 → 3.3% 원천징수', () => {
    const bookings = [
      booking({ influencer_commission: 500_000 }),
      booking({ influencer_commission: 500_000 }),
      booking({ influencer_commission: 500_000 }),
    ];
    const draft = computeSettlementDraft(bookings, 0, [], personalAffiliate, '2026-05', '2026-05-20');
    expect(draft.qualified).toBe(true);
    const expectedTax = Math.round(1_500_000 * 0.033);
    expect(draft.tax_deduction).toBe(expectedTax);
    expect(draft.final_payout).toBe(1_500_000 - expectedTax);
  });

  it('CORPORATE 제휴사 → 원천징수 없음', () => {
    const bookings = [
      booking({ influencer_commission: 1_000_000 }),
      booking({ influencer_commission: 1_000_000 }),
      booking({ influencer_commission: 1_000_000 }),
    ];
    const draft = computeSettlementDraft(bookings, 0, [], baseAffiliate, '2026-05', '2026-05-20');
    expect(draft.tax_deduction).toBe(0);
    expect(draft.final_payout).toBe(3_000_000);
  });

  it('self_referral_flag=true → 정산에서 제외', () => {
    const bookings = [
      booking({ influencer_commission: 100_000, self_referral_flag: true }), // 제외
      booking({ influencer_commission: 100_000 }),
      booking({ influencer_commission: 100_000 }),
      booking({ influencer_commission: 100_000 }), // 3건 충족
    ];
    const draft = computeSettlementDraft(bookings, 0, [], baseAffiliate, '2026-05', '2026-05-20');
    expect(draft.qualified_booking_count).toBe(3); // 셀레퍼럴 제외
    expect(draft.total_amount).toBe(300_000);
    expect(draft.booking_ids).not.toContain(bookings[0].id);
  });

  it('return_date > todayIso → 정산에서 제외', () => {
    const bookings = [
      booking({ return_date: '2026-06-01' }), // todayIso(2026-05-20) 이후 → 제외
      booking({ return_date: '2026-05-15' }),
      booking({ return_date: '2026-05-10' }),
      booking({ return_date: '2026-05-01' }),
    ];
    const draft = computeSettlementDraft(bookings, 0, [], baseAffiliate, '2026-05', '2026-05-20');
    expect(draft.qualified_booking_count).toBe(3);
  });

  it('return_date=null → 정산에서 제외', () => {
    const bookings = [
      booking({ return_date: null }),
      booking({ return_date: '2026-05-15' }),
      booking({ return_date: '2026-05-10' }),
      booking({ return_date: '2026-05-01' }),
    ];
    const draft = computeSettlementDraft(bookings, 0, [], baseAffiliate, '2026-05', '2026-05-20');
    expect(draft.qualified_booking_count).toBe(3);
  });

  it('prevCarryover 반영 — final_total 증가', () => {
    const bookings = [
      booking({ influencer_commission: 100_000 }),
      booking({ influencer_commission: 100_000 }),
      booking({ influencer_commission: 100_000 }),
    ];
    const draft = computeSettlementDraft(bookings, 200_000, [], baseAffiliate, '2026-05', '2026-05-20');
    expect(draft.final_total).toBe(500_000); // 300_000 + 200_000
    expect(draft.carryover_balance).toBe(200_000); // qualified → prevCarryover+adj(0)
  });

  it('조정액 반영 (양수 = bonus)', () => {
    const bookings = [
      booking({ influencer_commission: 100_000 }),
      booking({ influencer_commission: 100_000 }),
      booking({ influencer_commission: 100_000 }),
    ];
    const adjustments: PendingAdjustment[] = [{ id: 'adj-1', amount: 50_000 }];
    const draft = computeSettlementDraft(bookings, 0, adjustments, baseAffiliate, '2026-05', '2026-05-20');
    expect(draft.adjustment_amount).toBe(50_000);
    expect(draft.final_total).toBe(350_000);
    expect(draft.adjustment_ids).toEqual(['adj-1']);
  });

  it('조정액 반영 (음수 = clawback)', () => {
    const bookings = [
      booking({ influencer_commission: 100_000 }),
      booking({ influencer_commission: 100_000 }),
      booking({ influencer_commission: 100_000 }),
    ];
    const adjustments: PendingAdjustment[] = [{ id: 'adj-2', amount: -30_000 }];
    const draft = computeSettlementDraft(bookings, 0, adjustments, baseAffiliate, '2026-05', '2026-05-20');
    expect(draft.adjustment_amount).toBe(-30_000);
    expect(draft.final_total).toBe(270_000);
  });

  it('빈 배열 → qualified=false, 모든 값 0', () => {
    const draft = computeSettlementDraft([], 0, [], baseAffiliate, '2026-05', '2026-05-20');
    expect(draft.qualified).toBe(false);
    expect(draft.qualified_booking_count).toBe(0);
    expect(draft.total_amount).toBe(0);
    expect(draft.final_payout).toBe(0);
    expect(draft.booking_ids).toEqual([]);
  });

  it('influencer_commission=null → 0으로 처리', () => {
    const bookings = [
      booking({ influencer_commission: null }),
      booking({ influencer_commission: null }),
      booking({ influencer_commission: null }),
    ];
    const draft = computeSettlementDraft(bookings, 0, [], baseAffiliate, '2026-05', '2026-05-20');
    expect(draft.total_amount).toBe(0);
  });

  it('adjustment amount가 문자열이면 Number()로 변환', () => {
    const bookings = [
      booking({ influencer_commission: 100_000 }),
      booking({ influencer_commission: 100_000 }),
      booking({ influencer_commission: 100_000 }),
    ];
    const adjustments: PendingAdjustment[] = [{ id: 'adj-3', amount: '50000' }];
    const draft = computeSettlementDraft(bookings, 0, adjustments, baseAffiliate, '2026-05', '2026-05-20');
    expect(draft.adjustment_amount).toBe(50_000);
  });

  it('booking_ids는 qualified 예약의 id 배열', () => {
    const b1 = booking({ id: 'bk-a' });
    const b2 = booking({ id: 'bk-b', self_referral_flag: true }); // 제외
    const b3 = booking({ id: 'bk-c' });
    const b4 = booking({ id: 'bk-d' });
    const draft = computeSettlementDraft([b1, b2, b3, b4], 0, [], baseAffiliate, '2026-05', '2026-05-20');
    expect(draft.booking_ids).toEqual(['bk-a', 'bk-c', 'bk-d']);
  });
});
