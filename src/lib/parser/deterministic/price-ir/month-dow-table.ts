import { extractPriceTable } from '../price-table.ts';
import type { PriceIROptions, PriceIRResult } from './types.ts';
import { tiersToRows } from './utils.ts';

export function extractMonthDowPriceIR(rawText: string, options: PriceIROptions = {}): PriceIRResult {
  const tiers = extractPriceTable(rawText, options.year);
  return tiers.length > 0
    ? { source: 'month_dow_table', tiers, rows: tiersToRows(tiers) }
    : { source: 'none', tiers: [], rows: [] };
}
