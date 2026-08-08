import crypto from 'node:crypto';

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;

export function resolveSettlementPeriodKst(period: string): {
  period: string;
  startUtc: string;
  endUtc: string;
} | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1) - KST_OFFSET_MS);
  const end = new Date(Date.UTC(year, monthIndex + 1, 1) - KST_OFFSET_MS);
  return { period, startUtc: start.toISOString(), endUtc: end.toISOString() };
}

export function settlementCommandHash(value: Record<string, unknown>): string {
  const stable = Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

export interface LedgerEntryForSettlement {
  id: string;
  bookingId: string | null;
  amountKrw: number;
  entryType: 'EARNED' | 'BONUS' | 'ADJUSTMENT' | 'REVERSAL' | 'MIGRATION';
  eligibleAt: string;
  held?: boolean;
}

/** Pure reference model mirrored by create_affiliate_settlement_run_v2. */
export function calculateLedgerSettlement(input: {
  entries: LedgerEntryForSettlement[];
  settledEntryIds: Set<string>;
  periodEndUtc: string;
  minPayoutKrw: number;
  minBookingCount: number;
  taxRate: number;
}) {
  const eligible = input.entries.filter(entry =>
    !entry.held
    && !input.settledEntryIds.has(entry.id)
    && entry.eligibleAt < input.periodEndUtc,
  );
  const grossCommissionKrw = eligible
    .filter(entry => ['EARNED', 'BONUS', 'MIGRATION'].includes(entry.entryType))
    .reduce((sum, entry) => sum + entry.amountKrw, 0);
  const adjustmentKrw = eligible
    .filter(entry => ['ADJUSTMENT', 'REVERSAL'].includes(entry.entryType))
    .reduce((sum, entry) => sum + entry.amountKrw, 0);
  const unsettledTotalKrw = grossCommissionKrw + adjustmentKrw;
  const qualifiedBookingCount = new Set(
    eligible.filter(entry => entry.amountKrw > 0 && entry.bookingId).map(entry => entry.bookingId as string),
  ).size;
  const qualified = unsettledTotalKrw >= input.minPayoutKrw
    && qualifiedBookingCount >= input.minBookingCount;
  const withholdingKrw = qualified ? Math.round(unsettledTotalKrw * input.taxRate) : 0;
  return {
    qualified,
    qualifiedBookingCount,
    grossCommissionKrw,
    adjustmentKrw,
    unsettledTotalKrw,
    withholdingKrw,
    netPayoutKrw: qualified ? unsettledTotalKrw - withholdingKrw : 0,
    frozenEntryIds: qualified ? eligible.map(entry => entry.id) : [],
  };
}

export function mapSettlementRpcError(message: string): { code: string; status: number } {
  if (message.includes('SETTLEMENT_POLICY_MISSING') || message.includes('SETTLEMENT_POLICY_MALFORMED')) {
    return { code: 'SETTLEMENT_POLICY_REQUIRED', status: 409 };
  }
  if (message.includes('IDEMPOTENCY_KEY_REUSED')) return { code: 'IDEMPOTENCY_KEY_REUSED', status: 409 };
  if (message.includes('SEPARATION_REQUIRED')) return { code: 'MAKER_CHECKER_REQUIRED', status: 409 };
  if (message.includes('NOT_FOUND')) return { code: 'NOT_FOUND', status: 404 };
  if (/NOT_READY|NOT_REQUESTED|NOT_APPROVED|MISMATCH|TRANSITION|HOLD_REASON/.test(message)) {
    return { code: 'SETTLEMENT_STATE_CONFLICT', status: 409 };
  }
  if (/INVALID_|EVIDENCE_REQUIRED|STATUS_NOT_ALLOWED/.test(message)) {
    return { code: 'INVALID_SETTLEMENT_COMMAND', status: 400 };
  }
  return { code: 'SETTLEMENT_COMMAND_FAILED', status: 500 };
}
