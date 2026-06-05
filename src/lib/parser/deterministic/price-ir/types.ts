import type { PriceTier } from '../price-table';
import type { MatrixPriceExtractOptions, MatrixPriceRow } from '../price-matrix';

export type PriceIRSource =
  | 'period_dow_matrix'
  | 'hotel_column_matrix'
  | 'spot_weekday_table'
  | 'weekday_period_table'
  | 'month_dow_table'
  | 'vertical_grade_table'
  | 'none';

export interface PriceIROptions extends MatrixPriceExtractOptions {
  year?: number;
  durationDays?: number | null;
  departureDays?: string | string[] | null;
}

export interface PriceIRResult {
  source: PriceIRSource;
  tiers: PriceTier[];
  rows: MatrixPriceRow[];
}

export type { MatrixPriceRow, PriceTier };
