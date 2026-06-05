import { extractPriceTable } from '../price-table';
import type { PriceIROptions, PriceIRResult } from './types';
import { tiersToRows } from './utils';

export function extractMonthDowPriceIR(rawText: string, options: PriceIROptions = {}): PriceIRResult {
  const tiers = extractPriceTable(rawText, options.year);
  return tiers.length > 0
    ? { source: 'month_dow_table', tiers, rows: tiersToRows(tiers) }
    : { source: 'none', tiers: [], rows: [] };
}
