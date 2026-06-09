import type { UploadPriceRecoveryResult } from './price-recovery';
import type { HumanReaderResult } from './ai-human-reader';

export type PriceRedTeamAuditResult = {
  status: 'pass' | 'warn' | 'fail';
  blockers: string[];
  warnings: string[];
  comparedDateCount: number;
  sourceBackedDateCount: number;
};

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function mapRecoveredPrices(priceRecovery: UploadPriceRecoveryResult): Map<string, number[]> {
  const byDate = new Map<string, number[]>();
  for (const row of priceRecovery.priceRows) {
    if (!row.target_date || !Number.isFinite(row.net_price) || row.net_price <= 0) continue;
    byDate.set(row.target_date, [...(byDate.get(row.target_date) ?? []), row.net_price]);
  }
  return byDate;
}

function mapHumanPrices(reader: HumanReaderResult): Map<string, number[]> {
  const byDate = new Map<string, number[]>();
  for (const pair of reader.pricePairs) {
    if (!pair.date || !Number.isFinite(pair.adult_price) || pair.adult_price <= 0) continue;
    byDate.set(pair.date, [...(byDate.get(pair.date) ?? []), pair.adult_price]);
  }
  return byDate;
}

function isModelDerivedPriceSource(source: string): boolean {
  return source === 'gemini'
    || source.endsWith(':gemini')
    || source === 'llm_hydrated'
    || source.endsWith(':llm_hydrated');
}

export function auditPriceExtractionAgainstSource(input: {
  priceRecovery: UploadPriceRecoveryResult;
  humanReader: HumanReaderResult;
}): PriceRedTeamAuditResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const recovered = mapRecoveredPrices(input.priceRecovery);
  const sourceBacked = mapHumanPrices(input.humanReader);
  const recoveredDates = sortedUnique([...recovered.keys()]);
  const sourceDates = sortedUnique([...sourceBacked.keys()]);
  const overlap = sourceDates.filter(date => recovered.has(date));

  if (sourceDates.length > 0 && recoveredDates.length === 0) {
    blockers.push(
      `price reader found ${sourceDates.length} source-backed price/date pairs but product price recovery produced no rows`,
    );
  }

  if (sourceDates.length === 0 && input.priceRecovery.ok && isModelDerivedPriceSource(input.priceRecovery.source)) {
    blockers.push(
      `model-derived price source ${input.priceRecovery.source} has no independent source-backed price/date evidence`,
    );
  }

  if (sourceDates.length >= 2 && recoveredDates.length > 0 && overlap.length === 0) {
    blockers.push(
      `price date disagreement: source-backed dates (${sourceDates.slice(0, 5).join(', ')}) do not overlap recovered dates (${recoveredDates.slice(0, 5).join(', ')})`,
    );
  }

  for (const date of overlap.slice(0, 50)) {
    const recoveredPrices = [...new Set(recovered.get(date) ?? [])].sort((a, b) => a - b);
    const sourcePrices = [...new Set(sourceBacked.get(date) ?? [])].sort((a, b) => a - b);
    const sourcePriceSet = new Set(sourcePrices);
    const missingRecoveredPrices = recoveredPrices.filter(price => !sourcePriceSet.has(price));
    if (missingRecoveredPrices.length > 0 && sourcePrices.length > 0) {
      blockers.push(
        `price amount disagreement ${date}: recovered ${missingRecoveredPrices.map(price => price.toLocaleString()).join(', ')} KRW not found in source-backed prices (${sourcePrices.slice(0, 8).map(price => price.toLocaleString()).join(', ')} KRW)`,
      );
    }
  }

  if (sourceDates.length === 0) {
    warnings.push('price reader did not find independent source-backed price/date pairs');
  }
  if (input.priceRecovery.ok && isModelDerivedPriceSource(input.priceRecovery.source)) {
    warnings.push('price recovery depends on Gemini fallback; require source-backed audit before publish');
  }

  return {
    status: blockers.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass',
    blockers,
    warnings,
    comparedDateCount: overlap.length,
    sourceBackedDateCount: sourceDates.length,
  };
}
