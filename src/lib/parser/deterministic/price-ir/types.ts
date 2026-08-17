import type { PriceTier } from '../price-table.ts';
import type { MatrixPriceExtractOptions, MatrixPriceRow } from '../price-matrix.ts';

export type PriceIRSource =
  | 'explicit_date_weekday_price'
  | 'compact_grade_period_table'
  | 'period_dow_matrix'
  | 'hotel_column_matrix'
  | 'spot_weekday_table'
  | 'labeled_date_list_price'
  | 'commercial_price_relation'
  | 'pdf_date_price_table'
  | 'cruise_cabin_price_table'
  | 'single_period_product_price'
  | 'product_price_vertical_date_table'
  | 'grade_pattern_date_matrix'
  | 'weekday_period_table'
  | 'month_dow_table'
  | 'month_duration_price_table'
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
  candidates?: PriceIRCandidate[];
  resolution?: PriceIRResolution;
}

export interface PriceIRCandidate {
  source: PriceIRSource;
  rows: MatrixPriceRow[];
  tiers: PriceTier[];
  specificity: number;
  priority: number;
  valid: boolean;
  issues: string[];
}

export interface PriceIRConflict {
  scopeKey: string;
  sources: PriceIRSource[];
  prices: number[];
}

export interface PriceIRResolution {
  status: 'none' | 'unique' | 'equivalent' | 'extended' | 'composed' | 'ambiguous';
  selectedSources: PriceIRSource[];
  rejectedSources: PriceIRSource[];
  conflicts: PriceIRConflict[];
}

export type { MatrixPriceRow, PriceTier };
