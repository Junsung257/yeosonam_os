import { parseTravelSettlementMemo } from './bank-statement-parser';
import { resolveClobeTransactionAuthority } from './clobe-transaction-authority';

export interface ProviderMemoObservation {
  seen: boolean;
  settlementKey: string | null;
}

export interface ProviderMemoChangeDecision extends ProviderMemoObservation {
  incomingSettlementKey: string | null;
  appliedSettlementKey: string | null;
  memoChanged: boolean;
  declassificationNeedsReview: boolean;
}

function normalizedSettlementKey(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return parseTravelSettlementMemo(value)?.normalizedKey ?? null;
}

export function getProviderMemoObservation(input: {
  source: string;
  sourceMetadata?: Record<string, unknown> | null;
  storedMemo?: string | null;
}): ProviderMemoObservation {
  const authority = resolveClobeTransactionAuthority({
    source: input.source,
    external_provider: 'clobe',
    memo: input.storedMemo,
    source_metadata: input.sourceMetadata,
  });
  return {
    seen: authority.providerMemoSeen,
    settlementKey: authority.providerMemoSeen
      ? authority.providerSettlementKey
      : authority.appliedSettlementKey,
  };
}

export function evaluateProviderMemoChange(input: {
  source: string;
  sourceMetadata?: Record<string, unknown> | null;
  storedMemo?: string | null;
  incomingMemo?: string | null;
  processed: boolean;
}): ProviderMemoChangeDecision {
  const observation = getProviderMemoObservation(input);
  const incomingSettlementKey = normalizedSettlementKey(input.incomingMemo);
  const appliedSettlementKey = normalizedSettlementKey(input.storedMemo);
  const memoChanged = appliedSettlementKey !== incomingSettlementKey;

  return {
    ...observation,
    incomingSettlementKey,
    appliedSettlementKey,
    memoChanged,
    declassificationNeedsReview: input.processed
      && incomingSettlementKey === null
      && memoChanged,
  };
}
