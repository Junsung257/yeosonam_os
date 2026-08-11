import { parseTravelSettlementMemo } from './bank-statement-parser';

export interface ProviderMemoObservation {
  seen: boolean;
  settlementKey: string | null;
}

export interface ProviderMemoChangeDecision extends ProviderMemoObservation {
  incomingSettlementKey: string | null;
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
  const providerEvidence = input.sourceMetadata?.[input.source];
  if (providerEvidence && typeof providerEvidence === 'object' && !Array.isArray(providerEvidence)) {
    const evidence = providerEvidence as Record<string, unknown>;
    const seen = Object.prototype.hasOwnProperty.call(evidence, 'settlement_key')
      || Object.prototype.hasOwnProperty.call(evidence, 'memo');
    if (seen) {
      return {
        seen: true,
        settlementKey: normalizedSettlementKey(evidence.settlement_key)
          ?? normalizedSettlementKey(evidence.memo),
      };
    }
  }

  return {
    seen: false,
    settlementKey: normalizedSettlementKey(input.storedMemo),
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
  const memoChanged = observation.settlementKey !== incomingSettlementKey;

  return {
    ...observation,
    incomingSettlementKey,
    memoChanged,
    declassificationNeedsReview: input.processed
      && incomingSettlementKey === null
      && (memoChanged || !observation.seen),
  };
}
