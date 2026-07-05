import { extractVerticalGradePriceTable, inferVerticalGradeFromText } from '../vertical-grade-price-table.ts';
import type { PriceIROptions, PriceIRResult } from './types.ts';
import { normalizeDepartureDays, tiersToRows } from './utils.ts';

export function extractVerticalGradePriceIR(rawText: string, options: PriceIROptions = {}): PriceIRResult {
  const tiers = extractVerticalGradePriceTable(rawText, {
    year: options.year,
    grade: inferVerticalGradeFromText(options.title ?? '') ?? options.title,
    durationDays: options.durationDays,
    title: options.title,
    departureDays: normalizeDepartureDays(options.departureDays),
  });
  return tiers.length > 0
    ? { source: 'vertical_grade_table', tiers, rows: tiersToRows(tiers) }
    : { source: 'none', tiers: [], rows: [] };
}
