import type {
  MatrixPriceRow,
  PriceIRCandidate,
  PriceIRConflict,
  PriceIROptions,
  PriceIRResolution,
  PriceIRResult,
  PriceIRSource,
} from './types.ts';
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
import { extractCommercialPriceRelationRows } from './commercial-price-relation.ts';
import { extractExplicitDateWeekdayPriceRows } from './explicit-date-weekday-price.ts';

type CandidateDefinition = {
  source: PriceIRSource;
  rows: MatrixPriceRow[];
  specificity: number;
  priority: number;
};

function normalizedText(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function nullableNumber(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function rowScopeKey(row: MatrixPriceRow): string {
  return [
    row.date,
    nullableNumber(row.min_travelers),
    nullableNumber(row.max_travelers),
    normalizedText(row.option_type),
    normalizedText(row.option_label),
  ].join('|');
}

function rowCriticalValueKey(row: MatrixPriceRow): string {
  return [row.adult_price, nullableNumber(row.child_price)].join('|');
}

function rowRichness(row: MatrixPriceRow): number {
  return [
    row.weekday,
    row.child_price,
    row.list_price,
    row.min_travelers,
    row.max_travelers,
    row.price_relation,
    row.note,
    row.status,
    row.option_label,
    row.option_type,
  ].filter(value => value !== null && value !== undefined && value !== '').length;
}

function sortRows(rows: MatrixPriceRow[]): MatrixPriceRow[] {
  return [...rows].sort((left, right) => (
    left.date.localeCompare(right.date)
    || (left.min_travelers ?? -1) - (right.min_travelers ?? -1)
    || (left.max_travelers ?? Number.MAX_SAFE_INTEGER) - (right.max_travelers ?? Number.MAX_SAFE_INTEGER)
    || 0
  ));
}

function normalizeCandidate(definition: CandidateDefinition): PriceIRCandidate {
  const byExactValue = new Map<string, MatrixPriceRow>();
  const valuesByScope = new Map<string, Set<string>>();
  const issues: string[] = [];
  for (const row of definition.rows) {
    if (!row.date || !Number.isFinite(row.adult_price) || row.adult_price <= 0) {
      issues.push('INVALID_PRICE_ROW');
      continue;
    }
    const scopeKey = rowScopeKey(row);
    const valueKey = rowCriticalValueKey(row);
    const scopeValues = valuesByScope.get(scopeKey) ?? new Set<string>();
    scopeValues.add(valueKey);
    valuesByScope.set(scopeKey, scopeValues);
    if (scopeValues.size > 1) issues.push(`INTERNAL_SCOPE_CONFLICT:${scopeKey}`);
    const exactKey = `${scopeKey}=${valueKey}`;
    const existing = byExactValue.get(exactKey);
    if (!existing) {
      byExactValue.set(exactKey, row);
      continue;
    }
    if (rowRichness(row) > rowRichness(existing)) byExactValue.set(exactKey, row);
  }
  const rows = sortRows([...byExactValue.values()]);
  // Keep internally conflicted candidates in the evidence graph. Resolution
  // decides whether a coherent peer should outrank them; if no peer exists we
  // still need to return the source rows so the publication gate can explain
  // the ambiguity instead of reporting an extraction failure.
  const valid = rows.length > 0;
  return {
    source: definition.source,
    rows,
    tiers: rowsToTiers(rows),
    specificity: definition.specificity,
    priority: definition.priority,
    valid,
    issues,
  };
}

function candidateSignature(candidate: PriceIRCandidate): string {
  return candidate.rows
    .map(row => `${rowScopeKey(row)}=${rowCriticalValueKey(row)}|${nullableNumber(row.list_price)}|${row.price_relation ?? ''}`)
    .join('\n');
}

function scopeConflict(left: MatrixPriceRow, right: MatrixPriceRow): boolean {
  return rowScopeKey(left) === rowScopeKey(right)
    && rowCriticalValueKey(left) !== rowCriticalValueKey(right);
}

function conflictsBetween(left: PriceIRCandidate, right: PriceIRCandidate): PriceIRConflict[] {
  const conflicts: PriceIRConflict[] = [];
  for (const leftRow of left.rows) {
    for (const rightRow of right.rows) {
      if (!scopeConflict(leftRow, rightRow)) continue;
      conflicts.push({
        scopeKey: rowScopeKey(leftRow),
        sources: [left.source, right.source],
        prices: [...new Set([leftRow.adult_price, rightRow.adult_price])].sort((a, b) => a - b),
      });
    }
  }
  return conflicts;
}

function rowsContainedIn(subset: MatrixPriceRow[], superset: MatrixPriceRow[]): boolean {
  return subset.every(row => superset.some(candidate => (
    rowScopeKey(candidate) === rowScopeKey(row)
    && rowCriticalValueKey(candidate) === rowCriticalValueKey(row)
  )));
}

function mergeCompatibleRows(candidates: PriceIRCandidate[]): MatrixPriceRow[] | null {
  if (candidates.length === 1) return candidates[0].rows;
  const byScope = new Map<string, MatrixPriceRow>();
  for (const candidate of candidates) {
    for (const row of candidate.rows) {
      const key = rowScopeKey(row);
      const existing = byScope.get(key);
      if (existing && rowCriticalValueKey(existing) !== rowCriticalValueKey(row)) return null;
      if (!existing || rowRichness(row) > rowRichness(existing)) byScope.set(key, row);
    }
  }
  const merged = [...byScope.values()];
  return sortRows(merged.filter(row => !merged.some(other => (
    other !== row
    && other.date === row.date
    && rowCriticalValueKey(other) === rowCriticalValueKey(row)
    && row.min_travelers == null
    && row.max_travelers == null
    && (other.min_travelers != null || other.max_travelers != null)
  ))));
}

function candidateDefinitions(rawText: string, options: PriceIROptions): CandidateDefinition[] {
  const prioritizedCommercial = /(?:→|⇒|➜|⟶|▶|->|=>|\d{1,3}\s*(?:명|인)\s*(?:이상|부터|기준)|\d{1,3}\s*(?:~|-|–|—)\s*\d{1,3}\s*(?:명|인))/u.test(rawText);
  const monthDow = extractMonthDowPriceIR(rawText, options);
  const verticalGrade = extractVerticalGradePriceIR(rawText, options);
  const productVerticalRows = extractProductPriceVerticalDateRows(rawText, options);
  const pdfDateRows = extractPdfDatePriceRows(rawText, options);
  const productVerticalUsesNamedGrade = productVerticalRows.some(row => (
    String(row.note ?? '').startsWith('source_vertical_grade_price')
    || String(row.note ?? '').startsWith('source_korean_grade_date_price')
  ));
  const productVerticalUsesTrustedStructure = productVerticalUsesNamedGrade
    || productVerticalRows.some(row => /^(?:source_korean_amount_before_date|source_korean_amount_before_grouped_dates|source_korean_date_before_amount|source_korean_grouped_dates_before_price|source_korean_duration_section_price|source_korean_hotel_month_day|source_korean_month_duration_price)/u.test(String(row.note ?? '')));
  const productVerticalHasCompleteGenericCoverage = productVerticalRows.length > 0
    && productVerticalRows.length >= pdfDateRows.length;
  return [
    // Priority is an explicit source-authority contract, preserving the
    // proven parser ordering while still running and retaining every parser.
    // A later generic parser can never outrank a supplier-aware candidate just
    // because it emitted more rows.
    { source: 'explicit_date_weekday_price', rows: extractExplicitDateWeekdayPriceRows(rawText, options), specificity: 5, priority: 180 },
    { source: 'commercial_price_relation', rows: extractCommercialPriceRelationRows(rawText, options), specificity: prioritizedCommercial ? 5 : 2, priority: prioritizedCommercial ? 175 : 5 },
    { source: 'spot_weekday_table', rows: extractSpotWeekdayRows(rawText, options), specificity: 5, priority: 170 },
    { source: 'compact_grade_period_table', rows: extractCompactGradePeriodRows(rawText, options), specificity: 4, priority: 160 },
    { source: 'labeled_date_list_price', rows: extractLabeledDateListPriceRows(rawText, options), specificity: 5, priority: 150 },
    { source: 'single_period_product_price', rows: extractSinglePeriodProductPriceRows(rawText, options), specificity: 3, priority: 140 },
    { source: 'cruise_cabin_price_table', rows: extractCruiseCabinPriceRows(rawText, options), specificity: 4, priority: 130 },
    { source: 'hotel_column_matrix', rows: extractHotelColumnMatrixRows(rawText, options), specificity: 4, priority: 120 },
    { source: 'grade_pattern_date_matrix', rows: extractGradePatternDateMatrixRows(rawText, options), specificity: 4, priority: 110 },
    { source: 'period_dow_matrix', rows: extractPeriodDowMatrixRows(rawText, options), specificity: 3, priority: 100 },
    { source: 'weekday_period_table', rows: extractWeekdayPeriodRows(rawText, options), specificity: 3, priority: 90 },
    { source: monthDow.source, rows: monthDow.rows, specificity: 3, priority: 80 },
    { source: 'month_duration_price_table', rows: extractMonthDurationPriceRows(rawText, options), specificity: 4, priority: 70 },
    {
      source: 'product_price_vertical_date_table',
      rows: productVerticalRows,
      specificity: productVerticalUsesTrustedStructure ? 5 : 3,
      priority: productVerticalUsesTrustedStructure ? 65 : productVerticalHasCompleteGenericCoverage ? 25 : 15,
    },
    { source: verticalGrade.source, rows: verticalGrade.rows, specificity: 4, priority: 50 },
    { source: 'pdf_date_price_table', rows: pdfDateRows, specificity: 2, priority: 20 },
  ];
}

export function extractPriceIRCandidates(rawText: string, options: PriceIROptions = {}): PriceIRCandidate[] {
  const candidates = candidateDefinitions(rawText, options)
    .filter(definition => definition.source !== 'none' && definition.rows.length > 0)
    .map(normalizeCandidate);
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const signature = `${candidate.source}\n${candidateSignature(candidate)}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

export function resolvePriceIRCandidates(candidates: PriceIRCandidate[]): PriceIRResult {
  const rankedValid = candidates
    .filter(candidate => candidate.valid && candidate.rows.length > 0)
    .sort((left, right) => (
      right.priority - left.priority
      || right.specificity - left.specificity
      || right.rows.length - left.rows.length
      || right.tiers.length - left.tiers.length
      || left.source.localeCompare(right.source)
    ));
  // A flattened document can make one parser emit a Cartesian product with
  // several different prices for the same departure date. If another parser
  // produced a conflict-free calendar, prefer that coherent candidate even
  // when its nominal parser priority is lower. When it is the only candidate,
  // retain it so the caller still receives the conflict evidence and can gate
  // publication explicitly rather than losing all source facts.
  const hasConflictFreeCandidate = rankedValid.some(candidate => (
    !candidate.issues.some(issue => issue.startsWith('INTERNAL_SCOPE_CONFLICT:'))
  ));
  const valid = hasConflictFreeCandidate
    ? rankedValid.filter(candidate => !candidate.issues.some(issue => issue.startsWith('INTERNAL_SCOPE_CONFLICT:')))
    : rankedValid;
  if (valid.length === 0) {
    return {
      source: 'none',
      tiers: [],
      rows: [],
      candidates,
      resolution: {
        status: 'none',
        selectedSources: [],
        rejectedSources: candidates.map(candidate => candidate.source),
        conflicts: [],
      },
    };
  }

  const highestSpecificity = valid[0].specificity;
  const topCandidate = valid[0];
  const sameAuthority = valid.filter(candidate => candidate.priority === topCandidate.priority);
  const equalAuthority = sameAuthority.filter(candidate => candidate.specificity === highestSpecificity);
  const peerConflicts = equalAuthority.flatMap((candidate, index) => (
    equalAuthority.slice(index + 1).flatMap(other => conflictsBetween(candidate, other))
  ));
  if (peerConflicts.length > 0) {
    return {
      source: 'none', tiers: [], rows: [], candidates,
      resolution: {
        status: 'ambiguous',
        selectedSources: [],
        rejectedSources: valid.map(candidate => candidate.source),
        conflicts: peerConflicts,
      },
    };
  }

  const peers = [topCandidate];
  const topDates = new Set(topCandidate.rows.map(row => row.date));
  for (const candidate of sameAuthority.slice(1)) {
    if (conflictsBetween(topCandidate, candidate).length > 0) continue;
    const addsNewDate = candidate.rows.some(row => !topDates.has(row.date));
    const equivalent = candidateSignature(candidate) === candidateSignature(topCandidate);
    if (addsNewDate || equivalent) peers.push(candidate);
  }
  const peerRows = mergeCompatibleRows(peers);
  if (!peerRows) {
    return {
      source: 'none', tiers: [], rows: [], candidates,
      resolution: {
        status: 'ambiguous',
        selectedSources: [],
        rejectedSources: valid.map(candidate => candidate.source),
        conflicts: peerConflicts,
      },
    };
  }

  const selectedSources = peers.map(candidate => candidate.source);
  let resolvedRows = peerRows;
  let dominant = peers[0];
  let status: PriceIRResolution['status'] = peers.length === 1 ? 'unique' : 'composed';

  // A broader parser may extend a direct-date seed only when it reproduces
  // every selected scope and value. No averaging, cheapest-price choice, or
  // majority vote is allowed.
  const extensibleSeed = topCandidate.source === 'explicit_date_weekday_price'
    || topCandidate.source === 'commercial_price_relation';
  for (const candidate of extensibleSeed
    ? valid.filter(item => item.priority < topCandidate.priority && item.specificity < highestSpecificity)
    : []) {
    if (candidate.rows.length <= resolvedRows.length) continue;
    if (!rowsContainedIn(resolvedRows, candidate.rows)) continue;
    resolvedRows = candidate.rows;
    dominant = candidate;
    selectedSources.push(candidate.source);
    status = 'extended';
    break;
  }

  const distinctSignatures = new Set(peers.map(candidateSignature));
  if (status === 'composed' && distinctSignatures.size === 1) status = 'equivalent';
  const selectedSet = new Set(selectedSources);
  return {
    source: dominant.source,
    rows: resolvedRows,
    tiers: rowsToTiers(resolvedRows),
    candidates,
    resolution: {
      status,
      selectedSources,
      rejectedSources: candidates.map(candidate => candidate.source).filter(source => !selectedSet.has(source)),
      conflicts: valid
        .filter(candidate => !selectedSet.has(candidate.source))
        .flatMap(candidate => conflictsBetween(dominant, candidate)),
    },
  };
}

export function extractPriceIR(rawText: string, options: PriceIROptions = {}): PriceIRResult {
  return resolvePriceIRCandidates(extractPriceIRCandidates(rawText, options));
}

export type {
  PriceIRCandidate,
  PriceIRConflict,
  PriceIROptions,
  PriceIRResolution,
  PriceIRResult,
  PriceIRSource,
} from './types.ts';
export { parseFinalSalePriceFromLine } from './commercial-price-relation.ts';
export {
  extractSourceWonAmounts,
  parseSourceWonAmount,
  sourceWonEvidenceContainsAmount,
} from './source-money.ts';
