import { extractPriceMatrix } from '../price-matrix';
import type { MatrixPriceRow, PriceIROptions } from './types';

const PERIOD_RE = /(\d{1,2})[./](\d{1,2})\s*[~\-–—]\s*(\d{1,2})[./](\d{1,2})/;
const PRICE_RE = /^([\d,]{3,10})(?:\s*[,\-]|\s*원)?\s*$/;
const DOW_LINE_RE = /^([일월화수목금토](?:[~\-][일월화수목금토])?|[일월화수목금토]{2,7}|매일)\s*$/;

function compactLabel(label: string): string {
  return label.replace(/\s+/g, '');
}

export function looksLikeHotelColumnMatrix(rawText: string): boolean {
  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const departureIdx = lines.findIndex(line => compactLabel(line) === '출발일');
  if (departureIdx < 0) return false;

  const periodIndex = lines.findIndex((line, index) => index > departureIdx && PERIOD_RE.test(line));
  if (periodIndex < 0) return false;

  const labels = lines
    .slice(departureIdx + 1, periodIndex)
    .filter(line => compactLabel(line) !== '요일')
    .filter(line => !DOW_LINE_RE.test(compactLabel(line)))
    .filter(line => !PRICE_RE.test(line));

  return labels.length >= 2;
}

export function extractHotelColumnMatrixRows(rawText: string, options: PriceIROptions = {}): MatrixPriceRow[] {
  if (!looksLikeHotelColumnMatrix(rawText)) return [];
  return extractPriceMatrix(rawText, options.year, {
    title: options.title,
    accommodations: options.accommodations,
    includeAllHotelColumns: true,
  });
}
