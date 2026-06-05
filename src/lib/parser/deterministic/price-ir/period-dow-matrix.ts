import { extractPriceMatrix } from '../price-matrix';
import { looksLikeHotelColumnMatrix } from './hotel-column-matrix';
import type { MatrixPriceRow, PriceIROptions } from './types';

export function extractPeriodDowMatrixRows(rawText: string, options: PriceIROptions = {}): MatrixPriceRow[] {
  if (looksLikeHotelColumnMatrix(rawText)) return [];
  return extractPriceMatrix(rawText, options.year, {
    title: options.title,
    accommodations: options.accommodations,
  });
}
