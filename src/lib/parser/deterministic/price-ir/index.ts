import type { PriceIROptions, PriceIRResult } from './types.ts';
import { extractCompactGradePeriodRows } from './compact-grade-period-table.ts';
import { extractHotelColumnMatrixRows } from './hotel-column-matrix.ts';
import { extractLabeledDateListPriceRows } from './labeled-date-list-price.ts';
import { extractMonthDowPriceIR } from './month-dow-table.ts';
import { extractMonthDurationPriceRows } from './month-duration-price-table.ts';
import { extractPeriodDowMatrixRows } from './period-dow-matrix.ts';
import { extractPdfDatePriceRows } from './pdf-date-price-table.ts';
import { extractCruiseCabinPriceRows } from './cruise-cabin-price-table.ts';
import { extractProductPriceVerticalDateRows } from './product-price-vertical-date-table.ts';
import { extractSinglePeriodProductPriceRows } from './single-period-product-price.ts';
import { extractSpotWeekdayRows } from './spot-weekday-table.ts';
import { extractGradePatternDateMatrixRows } from './grade-pattern-date-matrix.ts';
import { rowsToTiers } from './utils.ts';
import { extractVerticalGradePriceIR } from './vertical-grade-table.ts';
import { extractWeekdayPeriodRows } from './weekday-period-table.ts';

export function extractPriceIR(rawText: string, options: PriceIROptions = {}): PriceIRResult {
  const spotWeekdayRows = extractSpotWeekdayRows(rawText, options);
  if (spotWeekdayRows.length > 0) {
    return {
      source: 'spot_weekday_table',
      rows: spotWeekdayRows,
      tiers: rowsToTiers(spotWeekdayRows),
    };
  }

  const compactGradePeriodRows = extractCompactGradePeriodRows(rawText, options);
  if (compactGradePeriodRows.length > 0) {
    return {
      source: 'compact_grade_period_table',
      rows: compactGradePeriodRows,
      tiers: rowsToTiers(compactGradePeriodRows),
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

  const cruiseCabinRows = extractCruiseCabinPriceRows(rawText, options);
  if (cruiseCabinRows.length > 0) {
    return {
      source: 'cruise_cabin_price_table',
      rows: cruiseCabinRows,
      tiers: rowsToTiers(cruiseCabinRows),
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

  const pdfDatePriceRows = extractPdfDatePriceRows(rawText, options);
  if (pdfDatePriceRows.length > 0) {
    return {
      source: 'pdf_date_price_table',
      rows: pdfDatePriceRows,
      tiers: rowsToTiers(pdfDatePriceRows),
    };
  }

  return { source: 'none', tiers: [], rows: [] };
}

export type { PriceIROptions, PriceIRResult, PriceIRSource } from './types.ts';
