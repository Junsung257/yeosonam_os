import { extractPriceMatrix } from '../price-matrix.ts';
import { looksLikeHotelColumnMatrix } from './hotel-column-matrix.ts';
import type { MatrixPriceRow, PriceIROptions } from './types.ts';

export function extractPeriodDowMatrixRows(rawText: string, options: PriceIROptions = {}): MatrixPriceRow[] {
  if (looksLikeHotelColumnMatrix(rawText)) return [];
  return extractPriceMatrix(rawText, options.year, {
    title: options.title,
    accommodations: options.accommodations,
  });
}
