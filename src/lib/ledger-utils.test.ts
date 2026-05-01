/**
 * ledger-utils 단위 테스트 (Phase 2a 회귀 방어)
 *
 * 목적:
 *   - idempotency_key 컨벤션 동결 — 재시도 안전성의 근간
 *   - computeLedgerDelta 의 4 사분면 (입금·출금 × 정상·환불 × normal·rollback)
 *   - attachRunningBalance 누적 잔액 정확성
 *   - summarizeDrift positive/negative 분류
 */

import { describe, it, expect } from 'vitest';
import {
  idemKey,
  computeLedgerDelta,
  attachRunningBalance,
  summarizeDrift,
  isSeedEntry,
  isRefundEntry,
  isPayoutEntry,
  isManualSource,
  type DriftRow,
} from './ledger-utils';
import type { LedgerEntry } from '@/types/database';

// ─── idempotency_key 컨벤션 동결 ──────────────────────────────────

describe('idemKey — 멱등성 키 컨벤션', () => {
  it('slackAuto: bank_tx 기준', () => {
    expect(idemKey.slackAuto('tx-1')).toBe('slack:auto:tx-1');
  });

  it('bankTx vs paymentMatchConfirm 키 충돌 없음', () => {
    expect(idemKey.bankTx('tx-1')).toBe('bktx:tx-1');
    expect(idemKey.paymentMatchConfirm('tx-1')).toBe('pmc:tx-1');
    expect(idemKey.bankTx('tx-1')).not.toBe(idemKey.paymentMatchConfirm('tx-1'));
  });

  it('settlement create vs reverse 키 충돌 없음', () => {
    expect(idemKey.settlementCreate('s1', 'b1')).toBe('lsc:s1:b1');
    expect(idemKey.settlementReverse('s1', 'b1')).toBe('lsr:s1:b1');
  });

  it('seed 키는 paid/payout 분리', () => {
    expect(idemKey.seed('bk-1', 'paid_amount')).toBe('seed:bk-1:paid');
    expect(idemKey.seed('bk-1', 'total_paid_out')).toBe('seed:bk-1:payout');
  });

  it('rollback 접미는 base 와 다름', () => {
    const base = idemKey.bankTx('tx-1');
    const rb = idemKey.rollback(base);
    expect(rb).toBe('bktx:tx-1:rollback');
    expect(rb).not.toBe(base);
  });

  it('manual 키는 timestamp 의존 → 같은 호출에서도 시간 다르면 다름', () => {
    const k1 = idemKey.manual('bk-1', 1000);
    const k2 = idemKey.manual('bk-1', 2000);
    expect(k1).not.toBe(k2);
  });

  it('retroactive 키는 booking_id + bank_tx_id 조합', () => {
    expect(idemKey.retroactive('bk-1', 'tx-1')).toBe('retroactive:bk-1:tx-1');
  });
});

// ─── computeLedgerDelta — 4 사분면 ────────────────────────────────

describe('computeLedgerDelta — 거래유형 × 환불여부 × rollback', () => {
  it('일반 입금 → paid + amount, payout 0', () => {
    expect(computeLedgerDelta({ transactionType: '입금', amount: 100_000, isRefund: false }))
      .toEqual({ paidDelta: 100_000, payoutDelta: 0 });
  });

  it('환불(출금 + isRefund) → paid -amount', () => {
    expect(computeLedgerDelta({ transactionType: '출금', amount: 50_000, isRefund: true }))
      .toEqual({ paidDelta: -50_000, payoutDelta: 0 });
  });

  it('일반 출금(랜드사 송금) → payout +amount', () => {
    expect(computeLedgerDelta({ transactionType: '출금', amount: 800_000, isRefund: false }))
      .toEqual({ paidDelta: 0, payoutDelta: 800_000 });
  });

  it('rollback=true 면 부호 반전 (입금)', () => {
    expect(computeLedgerDelta({ transactionType: '입금', amount: 100_000, isRefund: false, rollback: true }))
      .toEqual({ paidDelta: -100_000, payoutDelta: 0 });
  });

  it('rollback=true 면 부호 반전 (출금)', () => {
    expect(computeLedgerDelta({ transactionType: '출금', amount: 800_000, isRefund: false, rollback: true }))
      .toEqual({ paidDelta: 0, payoutDelta: -800_000 });
  });

  it('rollback=true + 환불 → 두 번 음수 = 양수 (=입금 복원)', () => {
    expect(computeLedgerDelta({ transactionType: '출금', amount: 50_000, isRefund: true, rollback: true }))
      .toEqual({ paidDelta: 50_000, payoutDelta: 0 });
  });
});

// ─── attachRunningBalance ───────────────────────────────────────────

function entry(o: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: o.id ?? crypto.randomUUID(),
    booking_id: o.booking_id ?? 'bk-1',
    account: o.account ?? 'paid_amount',
    entry_type: o.entry_type ?? 'deposit',
    amount: o.amount ?? 0,
    currency: 'KRW',
    source: o.source ?? 'slack_ingest',
    source_ref_id: o.source_ref_id ?? null,
    idempotency_key: o.idempotency_key ?? null,
    memo: o.memo ?? null,
    created_by: o.created_by ?? null,
    created_at: o.created_at ?? new Date().toISOString(),
  };
}

describe('attachRunningBalance — 시간순 누적 잔액', () => {
  it('paid 만 누적', () => {
    const entries = [
      entry({ account: 'paid_amount', amount: 100_000 }),
      entry({ account: 'paid_amount', amount: 50_000 }),
    ];
    const out = attachRunningBalance(entries);
    expect(out[0].running_paid_balance).toBe(100_000);
    expect(out[1].running_paid_balance).toBe(150_000);
    expect(out[1].running_payout_balance).toBe(0);
  });

  it('paid + payout 독립 누적', () => {
    const entries = [
      entry({ account: 'paid_amount', amount: 100_000 }),
      entry({ account: 'total_paid_out', amount: 80_000 }),
      entry({ account: 'paid_amount', amount: 50_000 }),
    ];
    const out = attachRunningBalance(entries);
    expect(out[0].running_paid_balance).toBe(100_000);
    expect(out[0].running_payout_balance).toBe(0);
    expect(out[1].running_paid_balance).toBe(100_000);
    expect(out[1].running_payout_balance).toBe(80_000);
    expect(out[2].running_paid_balance).toBe(150_000);
    expect(out[2].running_payout_balance).toBe(80_000);
  });

  it('환불은 음수 amount 로 누적', () => {
    const entries = [
      entry({ account: 'paid_amount', amount: 100_000, entry_type: 'deposit' }),
      entry({ account: 'paid_amount', amount: -30_000, entry_type: 'refund' }),
    ];
    const out = attachRunningBalance(entries);
    expect(out[1].running_paid_balance).toBe(70_000);
  });

  it('빈 배열 → 빈 배열', () => {
    expect(attachRunningBalance([])).toEqual([]);
  });
});

// ─── summarizeDrift ──────────────────────────────────────────────────

describe('summarizeDrift — drift 통계', () => {
  it('drift 0건 → 모두 0', () => {
    const out = summarizeDrift([]);
    expect(out).toEqual({ count: 0, totalAbs: 0, positive: 0, negative: 0 });
  });

  it('positive (bookings > ledger) 와 negative 분류', () => {
    const rows: DriftRow[] = [
      { booking_id: 'b1', account: 'paid_amount', bookings_balance: 100, ledger_sum: 80, drift: 20 },
      { booking_id: 'b2', account: 'paid_amount', bookings_balance: 50, ledger_sum: 70, drift: -20 },
      { booking_id: 'b3', account: 'total_paid_out', bookings_balance: 200, ledger_sum: 200, drift: 0 },
    ];
    const out = summarizeDrift(rows);
    expect(out.count).toBe(3);
    expect(out.totalAbs).toBe(40);
    expect(out.positive).toBe(1);
    expect(out.negative).toBe(1);
  });
});

// ─── 분류 헬퍼 ────────────────────────────────────────────────────────

describe('분류 헬퍼', () => {
  it('isSeedEntry — entry_type+source 둘 다 매칭', () => {
    expect(isSeedEntry({ entry_type: 'seed_backfill', source: 'seed_phase2a' })).toBe(true);
    expect(isSeedEntry({ entry_type: 'seed_backfill', source: 'slack_ingest' })).toBe(false);
    expect(isSeedEntry({ entry_type: 'deposit', source: 'seed_phase2a' })).toBe(false);
  });

  it('isRefundEntry / isPayoutEntry', () => {
    expect(isRefundEntry({ entry_type: 'refund' })).toBe(true);
    expect(isRefundEntry({ entry_type: 'deposit' })).toBe(false);
    expect(isPayoutEntry({ entry_type: 'payout' })).toBe(true);
    expect(isPayoutEntry({ entry_type: 'payout_reverse' })).toBe(true);
    expect(isPayoutEntry({ entry_type: 'deposit' })).toBe(false);
  });

  it('isManualSource — 어드민/매칭/통장수동만 manual', () => {
    expect(isManualSource('admin_manual_edit')).toBe(true);
    expect(isManualSource('bank_tx_manual_match')).toBe(true);
    expect(isManualSource('payment_match_confirm')).toBe(true);
    expect(isManualSource('slack_ingest')).toBe(false);
    expect(isManualSource('cron_resync')).toBe(false);
  });
});
