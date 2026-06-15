import type { PriceIROptions, PriceIRResult } from './types';
import { extractHotelColumnMatrixRows } from './hotel-column-matrix';
import { extractLabeledDateListPriceRows } from './labeled-date-list-price';
import { extractMonthDowPriceIR } from './month-dow-table';
import { extractMonthDurationPriceRows } from './month-duration-price-table';
import { extractPeriodDowMatrixRows } from './period-dow-matrix';
import { extractProductPriceVerticalDateRows } from './product-price-vertical-date-table';
import { extractSinglePeriodProductPriceRows } from './single-period-product-price';
import { extractSpotWeekdayRows } from './spot-weekday-table';
import { extractGradePatternDateMatrixRows } from './grade-pattern-date-matrix';
import { rowsToTiers } from './utils';
import { extractVerticalGradePriceIR } from './vertical-grade-table';
import { extractWeekdayPeriodRows } from './weekday-period-table';

export function extractPriceIR(rawText: string, options: PriceIROptions = {}): PriceIRResult {
  const spotWeekdayRows = extractSpotWeekdayRows(rawText, options);
  if (spotWeekdayRows.length > 0) {
    return {
      source: 'spot_weekday_table',
      rows: spotWeekdayRows,
      tiers: rowsToTiers(spotWeekdayRows),
    };
  }

  const labeledDateListRows = extractLabeledDateListPriceRows(rawText, options);
  if (labeledDateListRows.length > 0) {
    return {
      source: 'labeled_date_list_price',
      rows: labeledDateListRows,
      tiers: rowsToTiers(labeledDateListRows),
    };
  }

  const singlePeriodRows = extractSinglePeriodProductPriceRows(rawText, options);
  if (singlePeriodRows.length > 0) {
    return {
      source: 'single_period_product_price',
      rows: singlePeriodRows,
      tiers: rowsToTiers(singlePeriodRows),
    };
  }

  const hotelColumnRows = extractHotelColumnMatrixRows(rawText, options);
  if (hotelColumnRows.length > 0) {
    return {
      source: 'hotel_column_matrix',
      rows: hotelColumnRows,
      tiers: rowsToTiers(hotelColumnRows),
    };
  }

  const gradePatternDateRows = extractGradePatternDateMatrixRows(rawText, options);
  if (gradePatternDateRows.length > 0) {
    return {
      source: 'grade_pattern_date_matrix',
      rows: gradePatternDateRows,
      tiers: rowsToTiers(gradePatternDateRows),
    };
  }

  const periodDowRows = extractPeriodDowMatrixRows(rawText, options);
  if (periodDowRows.length > 0) {
    return {
      source: 'period_dow_matrix',
      rows: periodDowRows,
      tiers: rowsToTiers(periodDowRows),
    };
  }

  const weekdayPeriodRows = extractWeekdayPeriodRows(rawText, options);
  if (weekdayPeriodRows.length > 0) {
    return {
      source: 'weekday_period_table',
      rows: weekdayPeriodRows,
      tiers: rowsToTiers(weekdayPeriodRows),
    };
  }

  const monthDow = extractMonthDowPriceIR(rawText, options);
  if (monthDow.rows.length > 0) return monthDow;

  const monthDurationRows = extractMonthDurationPriceRows(rawText, options);
  if (monthDurationRows.length > 0) {
    return {
      source: 'month_duration_price_table',
      rows: monthDurationRows,
      tiers: rowsToTiers(monthDurationRows),
    };
  }

  const productPriceVerticalRows = extractProductPriceVerticalDateRows(rawText, options);
  if (productPriceVerticalRows.length > 0) {
    return {
      source: 'product_price_vertical_date_table',
      rows: productPriceVerticalRows,
      tiers: rowsToTiers(productPriceVerticalRows),
    };
  }

  const verticalGrade = extractVerticalGradePriceIR(rawText, options);
  if (verticalGrade.rows.length > 0) return verticalGrade;

  return { source: 'none', tiers: [], rows: [] };
}

export type { PriceIROptions, PriceIRResult, PriceIRSource } from './types';
