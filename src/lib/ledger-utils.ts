/**
 * Phase 2a Ledger 순수 헬퍼.
 *   - JS 측에서 일관되게 사용하는 idempotency_key 생성기
 *   - applyLedger 의 sign / delta 분배 로직 (slack-ingest 와 bank-transactions 가 동일)
 *   - LedgerViewer / reconcile UI 의 누적 잔액 계산
 *
 * DB 측 RPC(record_ledger_entry / update_booking_ledger) 와 협업.
 * 이 모듈은 부수효과 없음 — pure functions.
 */

import type { LedgerAccount, LedgerEntry, LedgerEntryType, LedgerSource } from '@/types/database';

// ─── Idempotency Key 컨벤션 ──────────────────────────────────────────────

/**
 * 멱등성 키 컨벤션 — 같은 외부 이벤트는 항상 같은 키를 만들도록 강제.
 * RPC 안에서 :paid / :payout 접미가 자동 분할되므로 여기서는 base 만 반환.
 */
export const idemKey = {
  /** Slack 자동 매칭: bank_transactions.id 기반 */
  slackAuto: (bankTxId: string) => `slack:auto:${bankTxId}`,
  /** 어드민 통장 매칭 / 일괄 자동 매칭 */
  bankTx: (bankTxId: string) => `bktx:${bankTxId}`,
  /** confirm_payment_match RPC 의 내부 키 (RPC 가 직접 생성하므로 참고용) */
  paymentMatchConfirm: (bankTxId: string) => `pmc:${bankTxId}`,
  /** settlement bundle 생성 */
  settlementCreate: (settlementId: string, bookingId: string) =>
    `lsc:${settlementId}:${bookingId}`,
  /** settlement reverse */
  settlementReverse: (settlementId: string, bookingId: string) =>
    `lsr:${settlementId}:${bookingId}`,
  /** 소급 매칭 (booking 신규 생성 시 historical bank_tx 흡수) */
  retroactive: (bookingId: string, bankTxId: string) =>
    `retroactive:${bookingId}:${bankTxId}`,
  /** bulk insert auto-match */
  bulk: (bankTxId: string) => `bulk:${bankTxId}`,
  /** 어드민 수동 paid_amount 편집 */
  manual: (bookingId: string, ts: number = Date.now()) =>
    `manual:${bookingId}:${ts}`,
  /** SMS 자동 매칭 */
  sms: (paymentId: string) => `sms:${paymentId}`,
  /** SMS 수동 매칭 */
  smsManual: (paymentId: string) => `sms:manual:${paymentId}`,
  /** Phase 2a 초기 seed (1회성) */
  seed: (bookingId: string, account: LedgerAccount) =>
    `seed:${bookingId}:${account === 'paid_amount' ? 'paid' : 'payout'}`,
  /** rollback (매칭 취소) — base 키에 :rollback 접미 */
  rollback: (baseKey: string) => `${baseKey}:rollback`,
};

// ─── Delta 분배 ───────────────────────────────────────────────────────────

/**
 * 거래 유형 → (paid_delta, payout_delta) 분배.
 * applyLedger / applyToBooking 에서 동일하게 쓰는 핵심 결정 로직.
 *
 * - 입금 + !isRefund      → paid +amount
 * - 입금 + isRefund(이상) → paid +amount   (실제로는 발생 안 함)
 * - 출금 + !isRefund      → payout +amount
 * - 출금 + isRefund       → paid -amount   (환불은 입금 차감)
 */
export function computeLedgerDelta(params: {
  transactionType: '입금' | '출금';
  amount: number;
  isRefund: boolean;
  rollback?: boolean;
}): { paidDelta: number; payoutDelta: number } {
  const sign = params.rollback ? -1 : 1;
  const { transactionType, amount, isRefund } = params;

  if (transactionType === '입금' && !isRefund) {
    return { paidDelta: amount * sign, payoutDelta: 0 };
  }
  if (isRefund) {
    return { paidDelta: -amount * sign, payoutDelta: 0 };
  }
  return { paidDelta: 0, payoutDelta: amount * sign };
}

// ─── 누적 잔액 (LedgerViewer / reconcile UI) ─────────────────────────────

export interface EntryWithRunningBalance extends LedgerEntry {
  running_paid_balance: number;
  running_payout_balance: number;
}

/**
 * 시간순 ledger entries → 누적 잔액 부착.
 * 입력은 created_at ASC 정렬되어 있어야 함.
 */
export function attachRunningBalance(entries: LedgerEntry[]): EntryWithRunningBalance[] {
  let runningPaid = 0;
  let runningPayout = 0;
  return entries.map(e => {
    if (e.account === 'paid_amount') runningPaid += e.amount;
    else if (e.account === 'total_paid_out') runningPayout += e.amount;
    return {
      ...e,
      running_paid_balance: runningPaid,
      running_payout_balance: runningPayout,
    };
  });
}

// ─── Source / Type 유틸 ──────────────────────────────────────────────────

export function isSeedEntry(e: Pick<LedgerEntry, 'entry_type' | 'source'>): boolean {
  return e.entry_type === 'seed_backfill' && e.source === 'seed_phase2a';
}

export function isRefundEntry(e: Pick<LedgerEntry, 'entry_type'>): boolean {
  return e.entry_type === 'refund';
}

export function isPayoutEntry(e: Pick<LedgerEntry, 'entry_type'>): boolean {
  return e.entry_type === 'payout' || e.entry_type === 'payout_reverse';
}

/** 자동 매칭(시스템) vs 수동 매칭(어드민) 분류 — UI 색상용 */
export function isManualSource(source: LedgerSource): boolean {
  return source === 'admin_manual_edit'
      || source === 'bank_tx_manual_match'
      || source === 'payment_match_confirm';
}

// ─── Drift 계산 (reconcile 결과 가공) ─────────────────────────────────────

export interface DriftRow {
  booking_id: string;
  account: LedgerAccount;
  bookings_balance: number;
  ledger_sum: number;
  drift: number;
}

export function summarizeDrift(rows: DriftRow[]): {
  count: number;
  totalAbs: number;
  positive: number;   // bookings > ledger (ledger 누락)
  negative: number;   // bookings < ledger (잔액 보정 누락)
} {
  let totalAbs = 0;
  let positive = 0;
  let negative = 0;
  for (const r of rows) {
    const d = Number(r.drift) || 0;
    totalAbs += Math.abs(d);
    if (d > 0) positive += 1;
    else if (d < 0) negative += 1;
  }
  return { count: rows.length, totalAbs, positive, negative };
}

// 미사용 import 표시 방지
export type { LedgerEntry, LedgerEntryType, LedgerSource, LedgerAccount };
