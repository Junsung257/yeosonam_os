const STALE_PAYMENT_AGE_MS = 24 * 60 * 60 * 1000;

export interface PaymentStaleQueueRow {
  created_at?: string | null;
  match_status?: string | null;
  settlement_scope?: string | null;
}

export function isStalePaymentAttentionRow(
  row: PaymentStaleQueueRow,
  nowMs: number = Date.now(),
): boolean {
  if (row.settlement_scope === 'non_travel') return false;
  if (!['review', 'unmatched', 'error'].includes(row.match_status ?? '')) return false;

  const createdAtMs = Date.parse(row.created_at ?? '');
  return Number.isFinite(createdAtMs) && nowMs - createdAtMs >= STALE_PAYMENT_AGE_MS;
}

export function getStalePaymentAttentionRows<T extends PaymentStaleQueueRow>(
  rows: readonly T[],
  nowMs: number = Date.now(),
): T[] {
  return rows
    .filter(row => isStalePaymentAttentionRow(row, nowMs))
    .slice()
    .sort((a, b) => Date.parse(a.created_at ?? '') - Date.parse(b.created_at ?? ''));
}
