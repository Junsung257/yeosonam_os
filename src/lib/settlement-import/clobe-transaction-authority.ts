import { parseTravelSettlementMemo } from './bank-statement-parser';

export interface ClobeTransactionAuthorityInput {
  source?: string | null;
  external_provider?: string | null;
  memo?: string | null;
  source_metadata?: Record<string, unknown> | null;
}

export interface ClobeTransactionAuthority {
  isClobe: boolean;
  providerMemoSeen: boolean;
  providerMemo: string | null;
  appliedMemo: string | null;
  effectiveMemo: string | null;
  providerSettlementKey: string | null;
  appliedSettlementKey: string | null;
  applicationPending: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanMemo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.normalize('NFKC').trim();
  return cleaned || null;
}

function settlementKey(value: string | null): string | null {
  return value ? parseTravelSettlementMemo(value)?.normalizedKey ?? null : null;
}

export function isClobeTransaction(input: ClobeTransactionAuthorityInput): boolean {
  return input.source === 'clobe_mcp'
    || input.source === 'clobe_api'
    || input.external_provider === 'clobe';
}

function providerEvidence(input: ClobeTransactionAuthorityInput): {
  seen: boolean;
  memo: string | null;
} {
  const preferredKeys = [input.source, 'clobe_mcp', 'clobe_api']
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);

  for (const key of preferredKeys) {
    const evidence = asRecord(input.source_metadata?.[key]);
    if (!evidence) continue;
    const seen = Object.prototype.hasOwnProperty.call(evidence, 'memo')
      || Object.prototype.hasOwnProperty.call(evidence, 'settlement_key');
    if (!seen) continue;
    return {
      seen: true,
      memo: cleanMemo(evidence.memo) ?? cleanMemo(evidence.settlement_key),
    };
  }

  return { seen: false, memo: null };
}

/**
 * Clobe is the source of truth for what the bank memo says now. The transaction
 * memo is deliberately tracked separately because it represents what Yeosonam
 * OS has actually reconciled into booking/allocation state.
 */
export function resolveClobeTransactionAuthority(
  input: ClobeTransactionAuthorityInput,
): ClobeTransactionAuthority {
  const isClobe = isClobeTransaction(input);
  const provider = isClobe ? providerEvidence(input) : { seen: false, memo: null };
  const appliedMemo = cleanMemo(input.memo);
  const providerMemo = provider.seen ? provider.memo : null;
  const effectiveMemo = provider.seen ? providerMemo : appliedMemo;
  const providerSettlementKey = settlementKey(providerMemo);
  const appliedSettlementKey = settlementKey(appliedMemo);

  return {
    isClobe,
    providerMemoSeen: provider.seen,
    providerMemo,
    appliedMemo,
    effectiveMemo,
    providerSettlementKey,
    appliedSettlementKey,
    applicationPending: isClobe
      && provider.seen
      && providerSettlementKey !== appliedSettlementKey,
  };
}

