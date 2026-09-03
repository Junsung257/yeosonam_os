import type { V3Evidence, V3PriceCalendarEntry } from '@/lib/product-registration-v3/types';
import {
  extractSourceWonAmounts,
  parseFinalSalePriceFromLine,
  parseSourceWonAmount,
} from '@/lib/parser/deterministic/price-ir';

import type { DocumentIR, DocumentIrTable, DocumentIrTableCell } from './types';

export type DocumentIrTablePriceCalendar = {
  tableId: string;
  durationDays: number;
  gradeLabel: string | null;
  /**
   * Supplier sheets can repeat the same duration/grade matrix for multiple
   * airlines. Keep that source axis so BX prices can never be merged into LJ
   * (or vice versa) merely because the dates and grade labels overlap.
   */
  transportCode?: string | null;
  productLabelKind?: 'duration' | 'hotel' | 'lodging_grade' | 'package_grade' | null;
  prices: V3PriceCalendarEntry[];
  sourceNodeIds: string[];
};

/**
 * Stable identity for one source-owned price axis. Table identity is part of
 * the key on purpose: two supplier tables may publish the same dates and
 * prices for different products, and equal values are not ownership proof.
 */
export function documentIrTablePriceCalendarAxisKey(
  calendar: Pick<
    DocumentIrTablePriceCalendar,
    'tableId' | 'durationDays' | 'transportCode' | 'gradeLabel' | 'productLabelKind'
  >,
): string {
  return JSON.stringify([
    calendar.tableId,
    calendar.durationDays,
    calendar.transportCode ?? null,
    calendar.gradeLabel ?? null,
    calendar.productLabelKind ?? null,
  ]);
}

const DATE_TOKEN_RE = /(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/?\s*[-~\u301C\u2013\u2014]\s*\/?\s*(?:(\d{1,2})\s*\/\s*)?(\d{1,2}))?/gu;
const WEEKDAYS: Record<string, number> = {
  '\uC77C': 0,
  '\uC6D4': 1,
  '\uD654': 2,
  '\uC218': 3,
  '\uBAA9': 4,
  '\uAE08': 5,
  '\uD1A0': 6,
};

type SourceCellPrice = {
  amount: number;
  listPrice: number | null;
  priceRelation: 'final_sale' | 'standard_sale' | null;
  sourceAmountScale: 1 | 1000;
};

export type SourcePriceAvailabilityStatus =
  | 'available'
  | 'inquiry'
  | 'sold_out'
  | 'not_operating';

export function sourcePriceAvailabilityStatus(value: string): SourcePriceAvailabilityStatus {
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (/(?:비\s*운항|운항\s*없음|항공\s*제외\s*일|항공\s*제외일)/u.test(normalized)) return 'not_operating';
  if (/(?:마감|매진|판매\s*종료|예약\s*불가|출발\s*불가)/u.test(normalized) || /^(?:X|×)$/iu.test(normalized)) return 'sold_out';
  if (/(?:별도\s*문의|문의\s*(?:요망|필요)|가격\s*문의)/u.test(normalized)) return 'inquiry';
  return 'available';
}

function sourceCellPrice(value: string): SourceCellPrice | null {
  const relation = parseFinalSalePriceFromLine(value);
  const candidates = extractSourceWonAmounts(value, {
    allowBareSaleShorthand: true,
    minAmount: 100_000,
    maxAmount: 50_000_000,
  });
  if (relation) {
    const finalCandidate = [...candidates].reverse().find(candidate => candidate.amount === relation.finalSalePrice);
    return {
      amount: relation.finalSalePrice,
      listPrice: relation.listPrice,
      priceRelation: relation.relation,
      sourceAmountScale: finalCandidate?.sourceAmountScale === 1000 ? 1000 : 1,
    };
  }
  if (candidates.length !== 1) return null;
  const candidate = candidates[0]!;
  return {
    amount: candidate.amount,
    listPrice: null,
    priceRelation: 'standard_sale',
    sourceAmountScale: candidate.sourceAmountScale === 1000 ? 1000 : 1,
  };
}

function iso(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function sourceYearFromText(value: string): number | null {
  const text = value.normalize('NFKC');
  const candidates: Array<{ index: number; year: number }> = [];
  for (const match of text.matchAll(/\b(20\d{2})\s*(?:\uB144|[.\-/]\s*\d{1,2})/gu)) {
    const index = match.index;
    const matched = match[0];
    const lineStart = text.lastIndexOf('\n', index - 1) + 1;
    const lineEnd = text.indexOf('\n', index + matched.length);
    const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
    const after = text.slice(index + matched.length, index + matched.length + 24);
    const narrativeDuration = /^\s*(?:\uC5D0\s*(?:\uAC78\uCCD0|\uAC78\uCE5C|\uB3D9\uC548|\uB9CC\uC5D0|\uC774\uC0C1|\uBBF8\uB9CC)|\uAC04|\uB3D9\uC548|\uC9F8)/u.test(after);
    const commercialContext = /(?:\uCD9C\s*\uBC1C|\uD589\s*\uC0AC|\uC5EC\uD589\s*\uAE30\s*\uAC04|\uC77C\s*\uC815|\uC0C1\s*\uD488|\uD328\uD0A4\uC9C0|PKG|\uC694\s*\uAE08|\uAC00\s*\uACA9|\uD2B9\s*\uAC00|\d{1,2}\s*\uC6D4)/iu.test(line);
    if (narrativeDuration && !commercialContext) continue;
    candidates.push({ index, year: Number(match[1]) });
  }
  for (const match of text.matchAll(/(?:^|\D)(\d{2})\s*\uB144/gu)) {
    const raw = match[0];
    const digitOffset = Math.max(0, raw.search(/\d/u));
    const index = match.index + digitOffset;
    const matchedEnd = match.index + raw.length;
    const lineStart = text.lastIndexOf('\n', index - 1) + 1;
    const lineEnd = text.indexOf('\n', matchedEnd);
    const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
    const after = text.slice(matchedEnd, matchedEnd + 24);
    const narrativeDuration = /^\s*(?:\uC5D0\s*(?:\uAC78\uCCD0|\uAC78\uCE5C|\uB3D9\uC548|\uB9CC\uC5D0|\uC774\uC0C1|\uBBF8\uB9CC)|\uAC04|\uB3D9\uC548|\uC9F8)/u.test(after);
    const explicitMonthAfter = /^\s*(?:\d{1,2}\s*\uC6D4|[.\-/]\s*\d{1,2})/u.test(after);
    const commercialContext = /(?:\uCD9C\s*\uBC1C|\uD589\s*\uC0AC|\uC5EC\uD589\s*\uAE30\s*\uAC04|\uC77C\s*\uC815|\uC0C1\s*\uD488|\uD328\uD0A4\uC9C0|PKG|\uC694\s*\uAE08|\uAC00\s*\uACA9|\uD2B9\s*\uAC00|\d{1,2}\s*\uC6D4)/iu.test(line);
    const filenameLikeLeadingYear = index <= 12 && !/[.!?。]/u.test(line.slice(0, index));
    if (narrativeDuration && !commercialContext && !explicitMonthAfter) continue;
    if (!commercialContext && !explicitMonthAfter && !filenameLikeLeadingYear) continue;
    candidates.push({ index, year: 2000 + Number(match[1]) });
  }
  return candidates.sort((left, right) => left.index - right.index)[0]?.year ?? null;
}

function rowDuration(cell: DocumentIrTableCell | undefined): number | null {
  const compact = cell?.text.normalize('NFKC').replace(/\s+/g, '') ?? '';
  const match = compact.match(/^(\d{1,2})\uC77C$/u);
  const value = Number(match?.[1]);
  return Number.isInteger(value) && value >= 2 && value <= 31 ? value : null;
}

function rowDurationFromCells(cells: DocumentIrTableCell[]): number | null {
  for (const cell of cells) {
    const direct = rowDuration(cell);
    if (direct) return direct;
    const match = cell.text.normalize('NFKC').replace(/\s+/g, '').match(/\d{1,2}\uBC15(\d{1,2})\uC77C/u);
    const value = Number(match?.[1]);
    if (Number.isInteger(value) && value >= 2 && value <= 31) return value;
  }
  return null;
}

function durationFromText(text: string): number | null {
  const normalized = text.normalize('NFKC').replace(/\s+/g, '');
  const nights = normalized.match(/\d{1,2}\uBC15(\d{1,2})\uC77C/u);
  const directAfter = normalized.match(/(?:^|\D)(\d{1,2})\uC77C(?:PKG|\uD328\uD0A4\uC9C0|\uC0C1\uD488|\uC5EC\uD589|\uD22C\uC5B4|\uC77C\uC815)/iu);
  const directBefore = normalized.match(/(?:PKG|\uD328\uD0A4\uC9C0|\uC0C1\uD488|\uC5EC\uD589|\uD22C\uC5B4|\uC77C\uC815|\uACE8\uD504)(\d{1,2})\uC77C/iu);
  const exact = normalized.match(/^(\d{1,2})\uC77C$/u);
  const value = Number(nights?.[1] ?? directAfter?.[1] ?? directBefore?.[1] ?? exact?.[1]);
  return Number.isInteger(value) && value >= 2 && value <= 31 ? value : null;
}

function durationDeltaFromText(text: string): number | null {
  const deltas = [...text.normalize('NFKC').matchAll(/(\d{1,2})\s*\uBC15\s*(\d{1,2})\s*\uC77C/gu)]
    .map(match => Number(match[2]) - Number(match[1]))
    .filter(delta => delta >= 1 && delta <= 3);
  const unique = [...new Set(deltas)];
  return unique.length === 1 ? unique[0]! : null;
}

function durationFromNights(value: string, dayDelta: number | null): number | null {
  if (!dayDelta) return null;
  const match = value.normalize('NFKC').replace(/\s+/gu, '').match(/^(\d{1,2})\uBC15$/u);
  const nights = Number(match?.[1]);
  const days = nights + dayDelta;
  return Number.isInteger(days) && days >= 2 && days <= 31 ? days : null;
}

function gradeHeaders(table: DocumentIrTable): Map<number, string> {
  const output = new Map<number, string>();
  const patterns = [
    '\uACE0\uD488\uACA9', '\uD504\uB9AC\uBBF8\uC5C4', '\uC2A4\uD0E0\uB2E4\uB4DC', '\uC2E4\uC18D', '\uD488\uACA9',
    '\uB7ED\uC154\uB9AC', '\uC138\uC774\uBE0C', '\uB77C\uC774\uD2B8', '\uD2B9\uAE09', '\uB514\uB7ED\uC2A4',
    '\uD06C\uB77C\uC6B4', 'Premium', 'Crown', 'Luxury',
  ];
  const traditionalGradeLabels = new Set(table.cells.flatMap(cell => {
    const value = cell.text.normalize('NFKC').replace(/\s+/g, '');
    const labels = patterns.filter(pattern => value.includes(pattern));
    return labels.length === 1 ? labels : [];
  }));
  const hasIndependentGradeMatrix = traditionalGradeLabels.size >= 2;
  for (const cell of table.cells) {
    const compact = cell.text.normalize('NFKC').replace(/\s+/g, '');
    // A merged footer can describe what the premium package includes and may
    // contain the same grade word as the real header. It must never create a
    // second grade column (for example column 0 from `▶ 화산·품격 ... 발권
    // 조건`). Grade headers are concise labels, not commercial/notice copy.
    if (compact.length > 48
      || /(?:\uBC1C\uAD8C|\uC5EC\uAD8C|\uC720\uD6A8\uAE30\uAC04|\uC870\uAC74\uC785\uB2C8\uB2E4|\uD3EC\uD568\uB0B4\uC5ED|\uBD88\uD3EC\uD568\uB0B4\uC5ED)/u.test(compact)) continue;
    // Grade-policy footers often start with the grade name but continue as a
    // sentence (`■세이브 ... : 가이드팁 현지 지불 / 쇼핑 3회`). HWP merged
    // cells place that prose in column 0; accepting it as a header moves the
    // matrix's first amount column to 0 and makes every real price row
    // unreadable. A colon-bearing grade description is evidence about the
    // product, never a numeric-axis header.
    if (/[:\uFF1A]/u.test(compact)) continue;
    // HWP suppliers often append a sales-status note to a departure roster
    // (`22,29품격확정일`). That describes those dates; it is not a grade
    // header for the roster column itself.
    if (/\d/u.test(compact) && /(?:확정|모객)/u.test(compact)
      && !/(?:PKG|패키지|노팁|노옵션|노쇼핑)/iu.test(compact)) continue;
    const matchedPatterns = patterns
      .filter(pattern => compact.includes(pattern))
      .filter(pattern => !patterns.some(other => other !== pattern && other.includes(pattern) && compact.includes(other)));
    // A merged title such as `실속/품격 특가 PKG` describes the whole table,
    // not the numeric column where the merged cell starts. Only a cell with a
    // single grade identity can own a price column.
    if (new Set(matchedPatterns.map(pattern => pattern.toLocaleLowerCase('ko-KR'))).size > 1) continue;
    const label = matchedPatterns[0]
      // `노팁노옵션` is a policy phrase inside a product title. Only the
      // exact standalone `노옵션` header, beside a real grade column such as
      // 실속/품격, is an independent price axis.
      ?? (compact === '\uB178\uC635\uC158' && hasIndependentGradeMatrix ? '\uB178\uC635\uC158' : null)
      ?? (compact.includes('\uB178\uB178') && compact.includes('\uD488\uACA9') ? '\uD488\uACA9' : null)
      ?? (compact.includes('\uB178\uB178') && compact.includes('\uB77C\uC774\uD2B8') ? '\uB77C\uC774\uD2B8' : null);
    // `4성)무엉탄럭셔리` is a hotel column, not a package-grade column.
    // Preserve exact `럭셔리`, `럭셔리&부용진`, and Luxury package labels,
    // but do not turn a rated hotel proper noun into a product axis.
    if (label && /^(?:\d\s*성\s*[)]?\s*)[^\n]{2,}(?:\uB7ED\uC154\uB9AC|luxury)$/iu.test(compact)
      && !/(?:패키지|팩|\bPKG\b|노팁|노옵션|부용진)/iu.test(compact)) continue;
    if (label) output.set(cell.column, label);
  }
  return output;
}

function explicitDepartureGradeHeaders(table: DocumentIrTable): Map<number, string> {
  const output = gradeHeaders(table);
  const tableText = table.cells.map(cell => cell.text).join('\n');
  if (!/\uCD9C\s*\uBC1C\s*\uC77C/u.test(tableText) || !/\uC0C1\s*\uD488\s*\uAC00/u.test(tableText)) return output;
  for (const cell of table.cells) {
    const compact = cell.text.normalize('NFKC').replace(/\s+/g, '');
    if (!/(?:\uD329|\uD328\uD0A4\uC9C0)/u.test(compact)) continue;
    if (compact.includes('\uB77C\uC774\uD2B8')) output.set(cell.column, '\uB77C\uC774\uD2B8');
    else if (compact.includes('\uD488\uACA9')) output.set(cell.column, '\uD488\uACA9');
  }
  return output;
}

function sourceTransportCode(value: string): string | null {
  const normalized = value.normalize('NFKC').toUpperCase();
  const bracketed = normalized.match(/\[\s*([A-Z0-9]{2})\s*(?:[-\]])/u)?.[1] ?? null;
  if (bracketed) return bracketed;
  const flight = normalized.match(/(?:^|[^A-Z0-9])([A-Z0-9]{2})\s*[- ]?\s*\d{2,4}(?:[^0-9]|$)/u)?.[1] ?? null;
  return flight;
}

/**
 * Reads a table that repeats an explicit-date grade matrix per airline:
 *
 *   [LJ-진에어] ... 3박5일
 *   출발일 | 라이트 | 품격
 *   9/16,18 | 529,000 | 639,000
 *   [BX-에어부산] ... 3박5일
 *   출발일 | 라이트 | 품격
 *   9/14,18 | 529,000 | 659,000
 *
 * The airline is a product axis, not a confidence signal. Calendars are kept
 * independent and the canonical worker later selects the airline proven by
 * the local product heading/itinerary. If it cannot, publication stays
 * blocked instead of choosing the cheapest or averaging the conflict.
 */
function parseTransportGradeDateMatrix(
  table: DocumentIrTable,
  fallbackYear: number | null,
  fallbackDurationDays: number | null,
): DocumentIrTablePriceCalendar[] {
  const tableText = table.cells.map(cell => cell.text).join('\n');
  const year = sourceYearFromText(tableText) ?? fallbackYear;
  if (!year) return [];
  const departureHeaders = table.cells
    .filter(cell => /출\s*발\s*일/u.test(cell.text))
    .sort((left, right) => left.row - right.row || left.column - right.column);
  if (departureHeaders.length === 0) return [];

  const calendars: DocumentIrTablePriceCalendar[] = [];
  for (const [headerIndex, departureHeader] of departureHeaders.entries()) {
    const nextHeaderRow = departureHeaders[headerIndex + 1]?.row ?? table.rows;
    const priorHeaderRow = departureHeaders[headerIndex - 1]?.row ?? -1;
    const contextCells = table.cells
      .filter(cell => cell.row > priorHeaderRow && cell.row < departureHeader.row)
      .sort((left, right) => right.row - left.row || left.column - right.column);
    const transportCell = contextCells.find(cell => sourceTransportCode(cell.text) != null) ?? null;
    const transportCode = transportCell ? sourceTransportCode(transportCell.text) : null;
    if (!transportCode || !transportCell) continue;
    const transportNodeId = transportCell.nodeId;
    const durationDays = contextCells
      .map(cell => durationFromText(cell.text))
      .find((value): value is number => value != null)
      ?? fallbackDurationDays;
    if (!durationDays) continue;

    const prospectiveHeaderCells = table.cells.filter(cell => (
      cell.row >= departureHeader.row
      && cell.row <= Math.min(departureHeader.row + 2, nextHeaderRow - 1)
    ));
    const grades = explicitDepartureGradeHeaders({ ...table, cells: prospectiveHeaderCells });
    if (grades.size < 2 || new Set(grades.values()).size !== grades.size) continue;
    const firstGradeColumn = Math.min(...grades.keys());
    const gradeHeaderRows = prospectiveHeaderCells
      .filter(cell => grades.has(cell.column) && gradeHeaders({ ...table, cells: [cell] }).size > 0)
      .map(cell => cell.row);
    const firstDataRow = Math.max(departureHeader.row, ...gradeHeaderRows) + 1;

    for (const [amountColumn, gradeLabel] of grades) {
      const byDate = new Map<string, V3PriceCalendarEntry>();
      const sourceNodeIds = new Set<string>([departureHeader.nodeId, transportNodeId]);
      let conflicted = false;
      for (let row = firstDataRow; row < nextHeaderRow; row += 1) {
        const rowDateCells = table.cells
          .filter(cell => cell.row === row && cell.column < firstGradeColumn)
          .map(cell => ({ cell, dates: dateEntries(cell.text, year) }))
          .filter(item => item.dates.length > 0);
        if (rowDateCells.length !== 1) continue;
        const amountCell = coveringCell(table, row, amountColumn);
        if (!amountCell || sourcePriceAvailabilityStatus(amountCell.text) !== 'available') continue;
        const price = sourceCellPrice(amountCell.text);
        if (!price) continue;
        const exactDates = [...new Set(rowDateCells[0]!.dates.flatMap(item => item.date ? [item.date] : []))];
        if (exactDates.length === 0) continue;
        for (const date of exactDates) {
          const entry: V3PriceCalendarEntry = {
            date,
            date_range: null,
            weekday: null,
            label: rowDateCells[0]!.cell.text.trim(),
            amount: price.amount,
            currency: 'KRW',
            list_price: price.listPrice,
            price_relation: price.priceRelation,
            evidence: evidence(table, rowDateCells[0]!.cell, amountCell, price.sourceAmountScale),
          };
          const previous = byDate.get(date);
          if (previous && (previous.amount !== entry.amount || previous.currency !== entry.currency)) {
            conflicted = true;
            break;
          }
          byDate.set(date, previous ?? entry);
        }
        if (conflicted) break;
        sourceNodeIds.add(rowDateCells[0]!.cell.nodeId);
        sourceNodeIds.add(amountCell.nodeId);
      }
      if (!conflicted && byDate.size > 0) {
        calendars.push({
          tableId: table.id,
          durationDays,
          gradeLabel,
          transportCode,
          productLabelKind: 'package_grade',
          prices: [...byDate.values()].sort((left, right) => String(left.date).localeCompare(String(right.date))),
          sourceNodeIds: [...sourceNodeIds],
        });
      }
    }
  }
  const transportCodes = new Set(calendars
    .map(calendar => calendar.transportCode)
    .filter((value): value is string => Boolean(value)));
  // A single-airline table is a normal duration/grade matrix and may contain
  // wide date ranges plus exceptions. Let the richer range parser own it.
  return transportCodes.size >= 2 && calendars.length >= 2 ? calendars : [];
}

function rowWeekdays(cells: DocumentIrTableCell[]): number[] {
  const text = cells
    .filter(cell => /\uCD9C\s*\uBC1C/u.test(cell.text))
    .map(cell => cell.text)
    .join('\n')
    .normalize('NFKC');
  if (!text) return [];
  return [...new Set([...text.matchAll(/([\uC77C\uC6D4\uD654\uC218\uBAA9\uAE08\uD1A0])(?:\uC694\uC77C)?/gu)]
    .map(match => WEEKDAYS[match[1]!])
    .filter((value): value is number => value != null))].sort((left, right) => left - right);
}

function dateEntries(text: string, year: number): Array<{
  date: string | null;
  dateRange: { start: string; end: string } | null;
  label: string;
}> {
  const normalized = text.normalize('NFKC');
  const output: Array<{ date: string | null; dateRange: { start: string; end: string } | null; label: string }> = [];
  for (const match of normalized.matchAll(/(?:(20\d{2}|\d{2})\s*\uB144\s*)?(\d{1,2})\s*\uC6D4\s*(\d{1,2})\s*\uC77C/gu)) {
    const explicitYear = match[1]
      ? (match[1].length === 2 ? 2000 + Number(match[1]) : Number(match[1]))
      : year;
    const date = iso(explicitYear, Number(match[2]), Number(match[3]));
    if (date) output.push({ date, dateRange: null, label: match[0].trim() });
  }
  for (const match of normalized.matchAll(/(\d{1,2})\s*월\s*-?\s*(\d{1,2}(?:\s*일)?(?:\s*,\s*\d{1,2}(?:\s*일)?)+)/gu)) {
    const month = Number(match[1]);
    for (const token of match[2]!.split(',')) {
      const day = Number(token.replace(/\s*일\s*/gu, '').trim());
      const date = iso(year, month, day);
      if (date && !output.some(item => item.date === date)) {
        output.push({ date, dateRange: null, label: `${month}월 ${day}일` });
      }
    }
  }
  for (const match of normalized.matchAll(DATE_TOKEN_RE)) {
    const startMonth = Number(match[1]);
    const startDay = Number(match[2]);
    const endMonth = match[4] ? Number(match[3] ?? match[1]) : null;
    const endDay = match[4] ? Number(match[4]) : null;
    const start = iso(year, startMonth, startDay);
    if (!start) continue;
    if (endMonth != null && endDay != null) {
      const endYear = endMonth < startMonth ? year + 1 : year;
      const end = iso(endYear, endMonth, endDay);
      if (!end || end < start) continue;
      output.push({ date: null, dateRange: { start, end }, label: match[0].trim() });
    } else {
      output.push({ date: start, dateRange: null, label: match[0].trim() });
    }
  }
  // Supplier price lines often keep the whole date roster before a departure
  // marker in the same cell (`9/6,13,20 出 - 399,000원`). Parse only that
  // proven roster prefix; the trailing price must never be interpreted as
  // additional day numbers.
  const listSource = normalized.match(/^\s*(.+?)\s*(?:\u51FA|\uCD9C(?:\uBC1C)?)(?=\s|$)/u)?.[1] ?? normalized;
  const listMatch = listSource.match(/^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\uC77C?((?:\s*,\s*(?:\d{1,2}\s*\/\s*)?\d{1,2}\s*\uC77C?)+)\s*$/u);
  if (listMatch && !/[-~\u301C]/u.test(listMatch[0])) {
    let month = Number(listMatch[1]);
    const tokens = [`${listMatch[1]}/${listMatch[2]}`, ...listMatch[3]!.split(',')
      .map(value => value.replace(/\s*\uC77C\s*$/u, '').trim())
      .filter(Boolean)];
    for (const token of tokens) {
      const full = token.match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/u);
      if (full) month = Number(full[1]);
      const day = Number(full?.[2] ?? token);
      const date = iso(year, month, day);
      if (date && !output.some(item => item.date === date)) output.push({ date, dateRange: null, label: `${month}/${day}` });
    }
  }
  // Compact supplier exception rosters often omit the repeated month and can
  // end with a day range: `7/23,24,26-28`. These are independent departure
  // dates, not one continuous 7/23~7/28 price range.
  const compactRoster = normalized.replace(/\s+/gu, '').match(
    /^(\d{1,2})\/(\d{1,2})((?:,\d{1,2}(?:[-~\u301C\u2013\u2014]\d{1,2})?)+)$/u,
  );
  if (compactRoster) {
    const month = Number(compactRoster[1]);
    const tokens = [compactRoster[2]!, ...compactRoster[3]!.slice(1).split(',')];
    for (const token of tokens) {
      const range = token.match(/^(\d{1,2})[-~\u301C\u2013\u2014](\d{1,2})$/u);
      const startDay = Number(range?.[1] ?? token);
      const endDay = Number(range?.[2] ?? startDay);
      if (endDay < startDay || endDay - startDay > 31) continue;
      for (let day = startDay; day <= endDay; day += 1) {
        const date = iso(year, month, day);
        if (date && !output.some(item => item.date === date)) {
          output.push({ date, dateRange: null, label: `${month}/${day}` });
        }
      }
    }
  }
  return output;
}

function parseVerticalScalarPrice(
  table: DocumentIrTable,
  fallbackYear: number | null,
  fallbackDurationDays: number | null,
): DocumentIrTablePriceCalendar[] {
  const tableText = table.cells.map(cell => cell.text).join('\n');
  const year = fallbackYear ?? sourceYearFromText(tableText);
  const durationDays = durationFromText(tableText) ?? fallbackDurationDays;
  if (!year || !durationDays) return [];

  const rows = Array.from({ length: table.rows }, (_, row) => (
    table.cells.filter(cell => cell.row === row).sort((left, right) => left.column - right.column)
  ));
  const dateRow = rows.find(cells => (
    cells.some(cell => /(?:\uCD9C\s*\uBC1C\s*\uC77C\s*\uC790?|\uC5EC\s*\uD589\s*\uAE30\s*\uAC04)/u.test(cell.text))
    && cells.some(cell => dateEntries(cell.text, year).length > 0)
  ));
  if (!dateRow) return [];
  const dateLabelCells = new Set(dateRow.filter(cell => (
    /(?:\uCD9C\s*\uBC1C\s*\uC77C\s*\uC790?|\uC5EC\s*\uD589\s*\uAE30\s*\uAC04)/u.test(cell.text)
    && dateEntries(cell.text, year).length === 0
  )).map(cell => cell.id));
  const datedCells = dateRow
    .filter(cell => !dateLabelCells.has(cell.id))
    .map(cell => {
      const dates = dateEntries(cell.text, year);
      const rowText = dateRow.map(item => item.text).join(' ').normalize('NFKC');
      if (
        /\uC5EC\s*\uD589\s*\uAE30\s*\uAC04/u.test(rowText)
        && !/\uCD9C\s*\uBC1C/u.test(cell.text)
        && /[-~\u301C\u2013\u2014]/u.test(cell.text)
      ) {
        const exactDates = dates.filter(item => item.date && !item.dateRange);
        const first = exactDates[0]?.date ?? null;
        const last = exactDates.at(-1)?.date ?? null;
        if (!first || !last) return { cell, dates: [] };
        const inclusiveDays = Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000) + 1;
        return inclusiveDays === durationDays ? { cell, dates: [exactDates[0]!] } : { cell, dates: [] };
      }
      return { cell, dates };
    })
    .filter(item => item.dates.length > 0);
  if (datedCells.length !== 1) return [];

  const priceRows = rows.filter(cells => cells.some(cell => (
    /(?:\uC5EC\s*\uD589\s*\uACBD\s*\uBE44|\uC0C1\s*\uD488\s*\uAC00|\uD310\s*\uB9E4\s*\uAC00|\uC131\s*\uC778\s*(?:\uAE30\s*\uC900)?\s*\uAC00)/u.test(cell.text)
  )));
  if (priceRows.length !== 1) return [];
  const priceRow = priceRows[0]!;
  if (priceRow.some(cell => dateEntries(cell.text, year).length > 0)) return [];
  const priceRowText = priceRow.map(cell => cell.text).join(' ').normalize('NFKC');
  if (/(?:\uC2F1\uAE00|\uC18C\uC544|\uCEE4\uBBF8\uC158|\uACC4\uC57D\uAE08|\uB370\uD30C\uC9D3|\uC635\uC158|\uD604\uC9C0\uBE44)/u.test(priceRowText)) return [];
  if (/\uC544\uB3D9/u.test(priceRowText) && !/(?:\uC131\uC778\s*\/\s*\uC544\uB3D9|\uC544\uB3D9\s*\/\s*\uC131\uC778)\s*(?:\uC694\uAE08\s*)?\uB3D9\uC77C/u.test(priceRowText)) return [];
  const amountCells = priceRow.filter(cell => sourceCellPrice(cell.text) != null);
  if (amountCells.length !== 1) return [];
  const amountCell = amountCells[0]!;
  const price = sourceCellPrice(amountCell.text);
  if (!price || /(?:\d\s*\uC131\s*\uAE09|\uB77C\uC774\uD2B8|\uD488\uACA9|\uD504\uB9AC\uBBF8\uC5C4)/u.test(amountCell.text)) return [];

  const dated = datedCells[0]!;
  return [{
    tableId: table.id,
    durationDays,
    gradeLabel: null,
    prices: dated.dates.map(item => ({
      date: item.date,
      date_range: item.dateRange,
      weekday: null,
      label: item.label,
      amount: price.amount,
      currency: 'KRW',
      list_price: price.listPrice,
      price_relation: price.priceRelation,
      evidence: evidence(table, dated.cell, amountCell, price.sourceAmountScale),
    })),
    sourceNodeIds: [dated.cell.nodeId, amountCell.nodeId],
  }];
}

/**
 * Reads a supplier's compact commercial block where a roster of departure
 * dates and the adult sale price live in different columns of the same row.
 *
 * Example:
 *   여행경비 | 4월 14,21,28일 / 5월 5,12,19,26일 | 849,000/인
 *
 * This is deliberately table-local. The duration and year must be proven by
 * the same physical table, and a row is accepted only inside the explicit
 * travel-cost block. This prevents a nearby single supplement, deposit, or a
 * second product's price from being attached to the dates.
 */
function parseCommercialRosterPriceRows(
  table: DocumentIrTable,
  fallbackYear: number | null,
  fallbackDurationDays: number | null,
): DocumentIrTablePriceCalendar[] {
  const tableText = table.cells.map(cell => cell.text).join('\n');
  const year = sourceYearFromText(tableText) ?? fallbackYear;
  const durationDays = durationFromText(tableText) ?? fallbackDurationDays;
  if (!year || !durationDays) return [];
  const hasDepartureScope = /출\s*발\s*(?:일\s*자?|날\s*짜)/u.test(tableText)
    || /매\s*주\s*[일월화수목금토](?:\s*요\s*일)?\s*출\s*발/u.test(tableText);
  if (!hasDepartureScope || !/(?:여\s*행\s*경\s*비|상\s*품\s*가|판\s*매\s*가)/u.test(tableText)) return [];

  const rows = Array.from({ length: table.rows }, (_, row) => (
    table.cells.filter(cell => cell.row === row).sort((left, right) => left.column - right.column)
  ));
  const explicitRowDurations = new Set(rows.map(rowDurationFromCells).filter(Boolean));
  if (explicitRowDurations.size >= 2) return [];
  const pricesByDate = new Map<string, V3PriceCalendarEntry>();
  const sourceNodeIds = new Set<string>();
  let insideCommercialBlock = false;
  let recognizedRows = 0;

  for (const cells of rows) {
    const rowText = cells.map(cell => cell.text).join(' ').normalize('NFKC');
    const startsCommercialBlock = /(?:여\s*행\s*경\s*비|상\s*품\s*가|판\s*매\s*가)/u.test(rowText);
    const startsAnotherSection = /(?:포\s*함\s*사\s*항|불\s*포\s*함|쇼\s*핑|비\s*고|날\s*짜|일\s*정)/u.test(rowText);
    if (startsCommercialBlock) insideCommercialBlock = true;
    else if (startsAnotherSection) insideCommercialBlock = false;
    if (!insideCommercialBlock) continue;
    if (/(?:싱글|아동|소아|유아|커미션|계약금|데파짓|옵션|현지비|유류\s*할증)/u.test(rowText)) continue;

    const amountCells = cells.filter(cell => sourceCellPrice(cell.text) != null);
    const datedCells = cells
      .filter(cell => !amountCells.some(amount => amount.id === cell.id))
      .map(cell => ({ cell, dates: dateEntries(cell.text, year) }))
      .filter(item => item.dates.length > 0);
    if (amountCells.length !== 1 || datedCells.length !== 1) continue;
    if (!/\d{1,2}\s*월/u.test(datedCells[0]!.cell.text.normalize('NFKC'))) continue;
    if (datedCells[0]!.dates.some(item => !item.date || item.dateRange)) continue;

    const amountCell = amountCells[0]!;
    const price = sourceCellPrice(amountCell.text);
    if (!price) continue;
    recognizedRows += 1;
    for (const item of datedCells[0]!.dates) {
      const entry: V3PriceCalendarEntry = {
        date: item.date,
        date_range: null,
        weekday: null,
        label: item.label,
        amount: price.amount,
        currency: 'KRW',
        list_price: price.listPrice,
        price_relation: price.priceRelation,
        evidence: evidence(table, datedCells[0]!.cell, amountCell, price.sourceAmountScale),
      };
      const previous = pricesByDate.get(item.date!);
      if (previous && previous.amount !== entry.amount) return [];
      pricesByDate.set(item.date!, previous ?? entry);
    }
    cells.filter(cell => startsCommercialBlock && /(?:여\s*행\s*경\s*비|상\s*품\s*가|판\s*매\s*가)/u.test(cell.text))
      .forEach(cell => sourceNodeIds.add(cell.nodeId));
    sourceNodeIds.add(datedCells[0]!.cell.nodeId);
    sourceNodeIds.add(amountCell.nodeId);
  }

  if (recognizedRows === 0 || pricesByDate.size === 0) return [];
  return [{
    tableId: table.id,
    durationDays,
    gradeLabel: null,
    productLabelKind: 'duration',
    prices: [...pricesByDate.values()].sort((left, right) => String(left.date).localeCompare(String(right.date))),
    sourceNodeIds: [...sourceNodeIds],
  }];
}

function evidence(
  table: DocumentIrTable,
  dateCell: DocumentIrTableCell,
  amountCell: DocumentIrTableCell,
  sourceAmountScale: 1 | 1000 = 1,
): V3Evidence {
  return {
    line_start: 1,
    line_end: 1,
    char_start: 0,
    char_end: Math.max(0, dateCell.text.length + amountCell.text.length),
    quote: `${dateCell.text}\n${amountCell.text}`,
    node_id: amountCell.nodeId,
    page: amountCell.evidence.page ?? table.page,
    table_id: table.id,
    row: amountCell.row,
    column: amountCell.column,
    quote_hash: amountCell.evidence.quoteHash,
    extraction_method: 'document_ir_table_cell',
    ...(sourceAmountScale === 1000 ? { source_amount_scale: sourceAmountScale } : {}),
  };
}

function explicitSalePriceFromText(value: string): SourceCellPrice | null {
  const normalized = value.normalize('NFKC').replace(/\u00a0/gu, ' ').trim();
  if (/\bNET\b/iu.test(normalized)) return null;
  const marker = normalized.match(
    /(?:1\s*인(?:당)?\s*)?(?:성인\s*)?(?:판매\s*가|상품\s*가|여행\s*경비|여행\s*요금|패키지\s*가격|초\s*특가|특가\s*할인|할인\s*가)/iu,
  );
  if (!marker || marker.index == null) return null;
  const saleText = normalized
    .replace(/\([^)]*(?:컴|커미션|수수료)[^)]*\)/giu, ' ')
    .replace(/(?:컴|커미션|수수료)\s*[:：]?\s*[\d,.]+\s*(?:만\s*)?원?.*$/giu, ' ')
    .trim();
  const direct = sourceCellPrice(saleText);
  if (direct) return direct;
  const trailingSaleText = saleText.slice(marker.index + marker[0].length).trim();
  const relation = parseFinalSalePriceFromLine(trailingSaleText);
  const candidates = extractSourceWonAmounts(trailingSaleText, {
    allowBareSaleShorthand: true,
    minAmount: 100_000,
    maxAmount: 50_000_000,
  });
  if (relation) {
    const finalCandidate = [...candidates].reverse().find(candidate => candidate.amount === relation.finalSalePrice);
    return {
      amount: relation.finalSalePrice,
      listPrice: relation.listPrice,
      priceRelation: relation.relation,
      sourceAmountScale: finalCandidate?.sourceAmountScale === 1000 ? 1000 : 1,
    };
  }
  if (candidates.length !== 1) return null;
  const candidate = candidates[0]!;
  return {
    amount: candidate.amount,
    listPrice: null,
    priceRelation: 'standard_sale',
    sourceAmountScale: candidate.sourceAmountScale === 1000 ? 1000 : 1,
  };
}

function sourceDateRosterEntries(value: string, year: number): ReturnType<typeof dateEntries> {
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || /(?:발권|예약|취소|환불|수정|기준|이후|이전|까지|마감)/u.test(normalized)) return [];
  const lines = normalized.split(/\r?\n/gu).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0 || lines.some(line => !/^(?:(?:20\d{2}\s*년\s*)?\d{1,2}\s*(?:\/|월)\s*\d{1,2}\s*일?(?:\s*(?:\([일월화수목금토](?:요일)?\)|[일월화수목금토](?:요일)?))?(?:\s*,\s*(?:(?:\d{1,2}\s*(?:\/|월)\s*)?\d{1,2}\s*일?(?:\s*(?:\([일월화수목금토](?:요일)?\)|[일월화수목금토](?:요일)?))?))*\s*(?:출발)?\s*)$/u.test(line))) {
    return [];
  }
  const entries = lines.flatMap(line => dateEntries(line, year));
  if (entries.some(entry => !entry.date || entry.dateRange)) return [];
  return [...new Map(entries.map(entry => [entry.date!, entry])).values()];
}

/**
 * Some supplier tables place a multiline departure roster above a single
 * `1인 판매가` row, with minimum-departure or commission rows in between.
 * Bind them only inside one physical table and only when both sides are
 * uniquely identifiable. Ambiguous tables deliberately fall through.
 */
function parseSharedDateRosterSalePrice(
  table: DocumentIrTable,
  fallbackYear: number | null,
  sectionDurationDays: number | null,
): DocumentIrTablePriceCalendar[] {
  if (!fallbackYear || !sectionDurationDays) return [];
  const rows = Array.from({ length: table.rows }, (_, row) => (
    table.cells.filter(cell => cell.row === row).sort((left, right) => left.column - right.column)
  ));
  const saleCells = table.cells
    .map(cell => ({ cell, price: explicitSalePriceFromText(cell.text) }))
    .filter((item): item is { cell: DocumentIrTableCell; price: SourceCellPrice } => item.price != null);
  if (saleCells.length !== 1) return [];
  const sale = saleCells[0]!;
  if (table.cells.some(cell => cell.id !== sale.cell.id && sourceCellPrice(cell.text) != null)) return [];
  const startRow = Math.max(0, sale.cell.row - 4);
  const datedCells = rows
    .slice(startRow, sale.cell.row + 1)
    .flatMap(cells => cells)
    .filter(cell => cell.id !== sale.cell.id)
    .map(cell => ({ cell, dates: sourceDateRosterEntries(cell.text, fallbackYear) }))
    .filter(item => item.dates.length > 0);
  if (datedCells.length !== 1) return [];
  const dated = datedCells[0]!;
  return [{
    tableId: table.id,
    durationDays: sectionDurationDays,
    gradeLabel: null,
    productLabelKind: 'duration',
    prices: dated.dates.map(item => ({
      date: item.date,
      date_range: null,
      weekday: null,
      label: item.label,
      amount: sale.price.amount,
      currency: 'KRW',
      list_price: sale.price.listPrice,
      price_relation: sale.price.priceRelation,
      evidence: evidence(table, dated.cell, sale.cell, sale.price.sourceAmountScale),
    })),
    sourceNodeIds: [dated.cell.nodeId, sale.cell.nodeId],
  }];
}

type RowSpannedProductPriceHeader = {
  row: number;
  productColumn: number;
  dateColumn: number;
  amountColumn: number;
};

function rowSpannedProductPriceHeader(table: DocumentIrTable): RowSpannedProductPriceHeader | null {
  for (let row = 0; row < table.rows; row += 1) {
    const cells = table.cells.filter(cell => cell.row === row);
    const compact = (cell: DocumentIrTableCell) => cell.text.normalize('NFKC').replace(/\s+/gu, '');
    const product = cells.find(cell => /^(?:상품명|상품구분|패키지명)$/u.test(compact(cell)));
    const date = cells.find(cell => /^(?:출발일|여행기간)$/u.test(compact(cell)));
    const amount = cells.find(cell => /^(?:상품가|판매가|여행경비|요금)$/u.test(compact(cell)));
    if (!product || !date || !amount) continue;
    if (new Set([product.column, date.column, amount.column]).size !== 3) continue;
    return {
      row,
      productColumn: product.column,
      dateColumn: date.column,
      amountColumn: amount.column,
    };
  }
  return null;
}

function compactProductAxisLabel(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function productAxisTokens(value: string): string[] {
  return [...new Set(value.normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[^0-9a-z\p{Script=Hangul}]+/gu, ' ')
    .split(/\s+/gu)
    .map(token => token.trim())
    .filter(token => token.length >= 2)
    .filter(token => !/^(?:상품|패키지|일정|출발|매일)$/u.test(token)))];
}

function productAxisMatchesLocalSection(label: string, sectionRawText: string): boolean {
  const local = (sectionRawText.split(/\n\s*---\s*\n/gu).at(-1) ?? sectionRawText)
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/\s+/gu, ' ');
  const localCompact = local.replace(/[^0-9a-z\p{Script=Hangul}]+/gu, '');
  const tokens = productAxisTokens(label);
  return tokens.length >= 2 && tokens.every(token => local.includes(token) || localCompact.includes(token));
}

function datesInInclusiveRange(start: string, end: string): string[] {
  const startTime = Date.parse(`${start}T00:00:00.000Z`);
  const endTime = Date.parse(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return [];
  const count = Math.floor((endTime - startTime) / 86_400_000) + 1;
  if (count < 1 || count > 400) return [];
  return Array.from({ length: count }, (_, index) => new Date(startTime + index * 86_400_000)
    .toISOString().slice(0, 10));
}

function weekdaysFromStandaloneLabel(value: string): number[] {
  const normalized = value.normalize('NFKC').replace(/\s+/gu, '');
  if (/^[\uC77C\uC6D4\uD654\uC218\uBAA9\uAE08\uD1A0]{1,7}$/u.test(normalized)) {
    return [...new Set([...normalized]
      .map(token => WEEKDAYS[token])
      .filter((weekday): weekday is number => weekday != null))].sort((left, right) => left - right);
  }
  const tokens = value.normalize('NFKC')
    .split(/[\s/,·]+/gu)
    .map(token => token.trim())
    .filter(Boolean);
  // This helper intentionally accepts only a standalone weekday label. HWP
  // vertical cells such as `제\n외\n일\n자` otherwise expose a lone `일`
  // token and incorrectly filter an exact exception date to Sundays. If any
  // Hangul token is not itself a weekday label, the cell is prose/context.
  const hangulTokens = tokens.filter(token => /\p{Script=Hangul}/u.test(token));
  if (hangulTokens.some(token => !/^([일월화수목금토])(?:요일)?$/u.test(token))) return [];
  return [...new Set(tokens.flatMap(token => {
    const match = token.match(/^([일월화수목금토])(?:요일)?$/u);
    const weekday = match ? WEEKDAYS[match[1]!] : null;
    return weekday == null ? [] : [weekday];
  }))].sort((left, right) => left - right);
}

function weekdaysFromDurationPatternLabel(value: string): number[] {
  const beforeDuration = value.normalize('NFKC').split(/\d/u)[0] ?? '';
  return weekdaysFromStandaloneLabel(beforeDuration);
}

function inquiryScopedDateKeys(value: string, year: number): Set<string> {
  const output = new Set<string>();
  const normalized = value.normalize('NFKC');
  const addEntries = (source: string, includeRolledAlternates = false): void => {
    const firstMonth = Number(source.match(/(\d{1,2})\s*\//u)?.[1]);
    for (const item of dateEntries(source, year)) {
      const values = item.date
        ? [item.date]
        : item.dateRange
          ? datesInInclusiveRange(item.dateRange.start, item.dateRange.end)
          : [];
      for (const date of values) {
        output.add(date);
        const month = Number(date.slice(5, 7));
        // A Dec-to-Mar inquiry list is parsed both in its literal fallback
        // year and its rollover year so neither representation can inherit a
        // numeric base price from the surrounding cross-year range.
        if (includeRolledAlternates && firstMonth >= 10 && month <= 3 && date.startsWith(`${year}-`)) {
          output.add(`${year + 1}-${date.slice(5)}`);
        }
      }
    }
  };
  const scoped = normalized.matchAll(
    /(\d{1,2}\s*\/\s*\d{1,2}(?:\s*[-~\u301C–—]\s*(?:(?:\d{1,2})\s*\/\s*)?\d{1,2})?)\s*별도\s*문의/gu,
  );
  for (const match of scoped) {
    addEntries(match[1]!);
  }
  for (const line of normalized.split(/\r?\n/gu)) {
    if (!/별도\s*문의/u.test(line) || !line.includes(',')) continue;
    const prefix = line.split(/별도\s*문의/u)[0]?.trim() ?? '';
    if (prefix) addEntries(prefix, true);
  }
  const markerIndex = normalized.search(/별도\s*문의/u);
  if (markerIndex >= 0) {
    const beforeMarkerLines = normalized.slice(0, markerIndex).split(/\r?\n/gu);
    if (beforeMarkerLines.length >= 3) {
      const continuedInquiryList = beforeMarkerLines.slice(1).join(' ').trim();
      if (continuedInquiryList) addEntries(continuedInquiryList, true);
    }
  }
  return output;
}

/**
 * Reads a single-product table shaped as `출발일/기간 | 요일 | 상품가`.
 * Supplier exception rows are authoritative: a dated `제외일자` with a
 * number is a special price, while `별도문의`, `마감`, and non-operating
 * dates remove the overlapping base weekday price instead of inheriting it.
 */
function parseRangeWeekdayPriceWithOverrides(
  table: DocumentIrTable,
  fallbackYear: number | null,
  fallbackDurationDays: number | null,
): DocumentIrTablePriceCalendar[] {
  if (!fallbackYear || !fallbackDurationDays) return [];
  let header: { row: number; dateColumn: number; weekdayColumn: number; amountColumn: number } | null = null;
  for (let row = 0; row < table.rows; row += 1) {
    const cells = table.cells.filter(cell => cell.row === row).sort((left, right) => left.column - right.column);
    const compact = (cell: DocumentIrTableCell) => cell.text.normalize('NFKC').replace(/\s+/gu, '');
    const dateCell = cells.find(cell => /^(?:출발일(?:\[[^\]]+\])?|출발기간|기간)$/u.test(compact(cell)));
    const weekdayCell = cells.find(cell => /^요일$/u.test(compact(cell)));
    if (!dateCell) continue;
    const amountCandidates = cells.filter(cell => cell.column > dateCell.column && cell.id !== weekdayCell?.id);
    if (amountCandidates.length !== 1) continue;
    const amountColumn = amountCandidates[0]!.column;
    const inferredWeekdayColumns = [...new Set(table.cells
      .filter(cell => (
        cell.row > row
        && cell.column > dateCell.column
        && cell.column < amountColumn
        && (weekdaysFromStandaloneLabel(cell.text).length > 0 || dateEntries(cell.text, fallbackYear).some(item => item.date != null))
      ))
      .map(cell => cell.column))];
    const weekdayColumn = weekdayCell?.column
      ?? (inferredWeekdayColumns.length === 1 ? inferredWeekdayColumns[0]! : null);
    if (weekdayColumn == null) continue;
    header = {
      row,
      dateColumn: dateCell.column,
      weekdayColumn,
      amountColumn,
    };
    break;
  }
  if (!header) return [];

  const byDate = new Map<string, { entry: V3PriceCalendarEntry; specificity: number }>();
  const datesWithoutNumericPrice = new Set<string>();
  const sourceNodeIds = new Set<string>();
  let recognizedWeekdayRangeRows = 0;
  let recognizedOverrideRows = 0;
  let rollingYear = fallbackYear;
  let lastDistinctDateCellId: string | null = null;
  let lastDistinctStartMonth: number | null = null;
  const resolvedDatesByCell = new Map<string, { year: number; dates: ReturnType<typeof dateEntries> }>();

  for (let row = header.row + 1; row < table.rows; row += 1) {
    const dateCell = coveringCell(table, row, header.dateColumn);
    const weekdayCell = coveringCell(table, row, header.weekdayColumn);
    const amountCell = coveringCell(table, row, header.amountColumn);
    if (!dateCell || !amountCell) continue;
    let resolved = resolvedDatesByCell.get(dateCell.id);
    if (!resolved) {
      const firstMonth = Number(dateCell.text.normalize('NFKC').match(/(\d{1,2})\s*\//u)?.[1]);
      if (
        lastDistinctDateCellId !== dateCell.id
        && lastDistinctStartMonth != null
        && firstMonth >= 1
        && firstMonth <= 12
        && lastDistinctStartMonth - firstMonth >= 6
      ) rollingYear += 1;
      resolved = { year: rollingYear, dates: dateEntries(dateCell.text, rollingYear) };
      resolvedDatesByCell.set(dateCell.id, resolved);
      if (firstMonth >= 1 && firstMonth <= 12) lastDistinctStartMonth = firstMonth;
      lastDistinctDateCellId = dateCell.id;
    }
    const middleDates = weekdayCell ? dateEntries(weekdayCell.text, resolved.year).filter(item => item.date != null) : [];
    const dates = middleDates.length > 0 ? middleDates : resolved.dates;
    if (dates.length === 0) continue;
    const effectiveDateCell = middleDates.length > 0 ? weekdayCell! : dateCell;
    inquiryScopedDateKeys(effectiveDateCell.text, resolved.year).forEach(date => datesWithoutNumericPrice.add(date));

    const amountStatus = sourcePriceAvailabilityStatus(amountCell.text);
    const rowText = [dateCell.text, weekdayCell?.text ?? '', amountCell.text].join(' ');
    const rowStatus = sourcePriceAvailabilityStatus(rowText);
    const weekdays = middleDates.length > 0 ? [] : weekdaysFromStandaloneLabel(weekdayCell?.text ?? '');
    const expanded = dates.flatMap(item => {
      const values = item.date
        ? [item.date]
        : item.dateRange
          ? datesInInclusiveRange(item.dateRange.start, item.dateRange.end)
          : [];
      return weekdays.length > 0
        ? values.filter(date => weekdays.includes(new Date(`${date}T00:00:00.000Z`).getUTCDay()))
        : values;
    });
    if (expanded.length === 0) continue;

    if (rowStatus === 'sold_out' || rowStatus === 'not_operating' || amountStatus === 'inquiry') {
      expanded.forEach(date => datesWithoutNumericPrice.add(date));
      continue;
    }
    const price = sourceCellPrice(amountCell.text);
    if (!price) continue;
    const hasRange = dates.some(item => item.dateRange != null);
    if (hasRange && weekdays.length > 0) recognizedWeekdayRangeRows += 1;
    if (dates.every(item => item.date != null)) recognizedOverrideRows += 1;
    const specificity = hasRange ? expanded.length : 0;
    for (const date of expanded) {
      const entry: V3PriceCalendarEntry = {
        date,
        date_range: null,
        weekday: null,
        label: date,
        amount: price.amount,
        currency: 'KRW',
        list_price: price.listPrice,
        price_relation: price.priceRelation,
        evidence: evidence(table, effectiveDateCell, amountCell, price.sourceAmountScale),
      };
      const previous = byDate.get(date);
      if (!previous || specificity < previous.specificity) byDate.set(date, { entry, specificity });
      else if (specificity === previous.specificity && previous.entry.amount !== entry.amount) return [];
    }
    [dateCell, effectiveDateCell, amountCell].filter(Boolean).forEach(cell => sourceNodeIds.add(cell!.nodeId));
  }

  datesWithoutNumericPrice.forEach(date => byDate.delete(date));
  if (
    recognizedWeekdayRangeRows < 2
    || (recognizedOverrideRows < 1 && datesWithoutNumericPrice.size === 0)
    || byDate.size === 0
  ) return [];
  return [{
    tableId: table.id,
    durationDays: fallbackDurationDays,
    gradeLabel: null,
    productLabelKind: null,
    prices: [...byDate.values()]
      .map(value => value.entry)
      .sort((left, right) => String(left.date).localeCompare(String(right.date))),
    sourceNodeIds: [...sourceNodeIds],
  }];
}

/**
 * Reads a shared supplier matrix shaped as:
 *
 *   출발일 | (기간/요일/예외일) | 실속 | 품격
 *
 * Duration and date-range cells can span several physical rows. Each grade
 * column is an independent customer product, and a dated exception row
 * overrides the wider weekday price for that one grade only. The result is
 * expanded to exact departure dates so a later section can select the proven
 * `duration + grade` axis without leaking the other column's price.
 */
export function parseDurationGradeRangePriceMatrix(
  table: DocumentIrTable,
  fallbackYear: number | null,
): DocumentIrTablePriceCalendar[] {
  const tableText = table.cells.map(cell => cell.text).join('\n');
  const year = sourceYearFromText(tableText) ?? fallbackYear;
  const hasDepartureHeader = /출\s*발\s*일/u.test(tableText);
  const hasMonthlyRoster = table.cells.some(cell => /^\s*\d{1,2}\s*월\s*$/u.test(cell.text.normalize('NFKC')));
  if (!year || (!hasDepartureHeader && !hasMonthlyRoster)) return [];

  const grades = gradeHeaders(table);
  if (grades.size < 2 || new Set(grades.values()).size !== grades.size) return [];
  const firstAmountColumn = Math.min(...grades.keys());
  const headerRows = new Set(table.cells
    .filter(cell => /출\s*발\s*일/u.test(cell.text) || grades.has(cell.column) && gradeHeaders({ ...table, cells: [cell] }).size > 0)
    .map(cell => cell.row));
  const headerRow = Math.min(...headerRows);
  if (!Number.isInteger(headerRow)) return [];

  type Target = {
    durationDays: number;
    gradeLabel: string;
    byDate: Map<string, { entry: V3PriceCalendarEntry; specificity: number }>;
    sourceNodeIds: Set<string>;
  };
  const targets = new Map<string, Target>();
  const invalidTargets = new Set<string>();

  for (let row = headerRow + 1; row < table.rows; row += 1) {
    const currentCells = table.cells
      .filter(cell => cell.row === row && cell.column < firstAmountColumn)
      .sort((left, right) => left.column - right.column);
    const coveredCells = table.cells
      .filter(cell => (
        cell.row <= row
        && row < cell.row + Math.max(1, cell.rowSpan)
        && cell.column < firstAmountColumn
      ))
      .sort((left, right) => left.column - right.column);
    const durationCell = coveredCells.find(cell => durationFromText(cell.text) != null)
      ?? table.cells
        .filter(cell => cell.row <= row && cell.column < firstAmountColumn && durationFromText(cell.text) != null)
        .sort((left, right) => right.row - left.row || left.column - right.column)[0]
      ?? null;
    const durationDays = durationCell ? durationFromText(durationCell.text) : null;
    if (!durationDays) continue;

    const currentScoped = currentCells
      .map(cell => ({ cell, dates: dateEntries(cell.text, year) }))
      .filter(item => item.dates.length > 0);
    const currentExactScoped = currentScoped.filter(item => item.dates.some(date => date.date != null));
    if (currentExactScoped.length > 1) continue;
    const coveredScoped = coveredCells
      .map(cell => ({ cell, dates: dateEntries(cell.text, year) }))
      .filter(item => item.dates.length > 0);
    const monthCell = coveredCells.find(cell => /^\s*\d{1,2}\s*월\s*$/u.test(cell.text.normalize('NFKC'))) ?? null;
    const month = Number(monthCell?.text.match(/\d{1,2}/u)?.[0]);
    const annotatedRosterCells = currentCells
      .filter(cell => cell.id !== durationCell.id && cell.id !== monthCell?.id)
      .map(cell => ({ cell, days: annotatedDepartureDaysFromMonthlyRoster(cell.text) }))
      .filter(item => item.days.length > 0);
    const durationWeekdayToken = durationCell.text.normalize('NFKC').match(/\[\s*([일월화수목금토])\s*\]/u)?.[1] ?? null;
    const durationWeekday = durationWeekdayToken ? WEEKDAYS[durationWeekdayToken] : null;
    const monthlySourceScope = monthCell
      && month >= 1 && month <= 12
      && annotatedRosterCells.length === 1
      ? {
          cell: annotatedRosterCells[0]!.cell,
          dates: annotatedRosterCells[0]!.days.flatMap(day => {
            const date = iso(year, month, day);
            if (!date) return [];
            if (durationWeekday != null && new Date(`${date}T00:00:00.000Z`).getUTCDay() !== durationWeekday) return [];
            return [{ date, dateRange: null, label: `${month}/${day}` }];
          }),
        }
      : null;
    const sourceScope = currentExactScoped[0]
      ?? (currentScoped.length === 1 ? currentScoped[0]! : null)
      ?? (monthlySourceScope?.dates.length === annotatedRosterCells[0]?.days.length ? monthlySourceScope : null)
      ?? (coveredScoped.length === 1 ? coveredScoped[0]! : null);
    if (!sourceScope) continue;
    const weekdayCell = currentCells.find(cell => weekdaysFromStandaloneLabel(cell.text).length === 1)
      ?? currentCells.find(cell => weekdaysFromStandaloneLabel(cell.text).length > 1)
      ?? null;
    const weekdays = weekdaysFromStandaloneLabel(weekdayCell?.text ?? '');

    const resolvedDates = [...new Set(sourceScope.dates.flatMap(item => {
      const dates = item.date
        ? [item.date]
        : item.dateRange
          ? datesInInclusiveRange(item.dateRange.start, item.dateRange.end)
          : [];
      return weekdays.length > 0
        ? dates.filter(date => weekdays.includes(new Date(`${date}T00:00:00.000Z`).getUTCDay()))
        : dates;
    }))];
    if (resolvedDates.length === 0) continue;
    const dateEvidenceCell = sourceScope.cell;
    const hasOnlyExactDates = sourceScope.dates.every(item => item.date != null && item.dateRange == null);
    const specificity = hasOnlyExactDates ? 0 : resolvedDates.length;

    for (const [amountColumn, gradeLabel] of grades) {
      const amountCell = coveringCell(table, row, amountColumn);
      if (!amountCell || sourcePriceAvailabilityStatus(amountCell.text) !== 'available') continue;
      const price = sourceCellPrice(amountCell.text);
      if (!price) continue;
      const key = `${durationDays}|${gradeLabel}`;
      if (invalidTargets.has(key)) continue;
      const target = targets.get(key) ?? {
        durationDays,
        gradeLabel,
        byDate: new Map<string, { entry: V3PriceCalendarEntry; specificity: number }>(),
        sourceNodeIds: new Set<string>(),
      };
      for (const date of resolvedDates) {
        const entry: V3PriceCalendarEntry = {
          date,
          date_range: null,
          weekday: null,
          label: hasOnlyExactDates
            ? dateEvidenceCell.text.trim()
            : `${dateEvidenceCell.text.trim()} ${weekdayCell?.text.trim() ?? ''}`.trim(),
          amount: price.amount,
          currency: 'KRW',
          list_price: price.listPrice,
          price_relation: price.priceRelation,
          evidence: evidence(table, dateEvidenceCell, amountCell, price.sourceAmountScale),
        };
        const previous = target.byDate.get(date);
        if (!previous || specificity < previous.specificity) {
          target.byDate.set(date, { entry, specificity });
        } else if (specificity === previous.specificity && previous.entry.amount !== entry.amount) {
          // One conflicted grade/duration axis must not erase independent
          // axes in the same supplier table. Keep that axis unavailable for
          // publication while allowing the other proven products to proceed.
          invalidTargets.add(key);
          targets.delete(key);
          break;
        }
      }
      if (invalidTargets.has(key)) continue;
      [durationCell, dateEvidenceCell, weekdayCell, amountCell]
        .filter((cell): cell is DocumentIrTableCell => Boolean(cell))
        .forEach(cell => target.sourceNodeIds.add(cell.nodeId));
      targets.set(key, target);
    }
  }

  const calendars = [...targets.values()]
    .filter(target => !invalidTargets.has(`${target.durationDays}|${target.gradeLabel}`))
    .filter(target => target.byDate.size > 0)
    .map(target => ({
      tableId: table.id,
      durationDays: target.durationDays,
      gradeLabel: target.gradeLabel,
      productLabelKind: 'package_grade' as const,
      prices: [...target.byDate.values()]
        .map(value => value.entry)
        .sort((left, right) => String(left.date).localeCompare(String(right.date))),
      sourceNodeIds: [...target.sourceNodeIds],
    }));
  return calendars.length >= 2 ? calendars : [];
}

/**
 * Reads a shared price sheet whose first column uses rowSpan to identify
 * independent products and whose rows contain compact supplier prices such as
 * `449,-`. A narrower date range is an explicit override of the wider base
 * range for the same product. Different product labels are never merged.
 */
function parseRowSpannedProductRangePriceTable(
  table: DocumentIrTable,
  fallbackYear: number | null,
  fallbackDurationDays: number | null,
  sectionRawText: string,
): DocumentIrTablePriceCalendar[] {
  const header = rowSpannedProductPriceHeader(table);
  if (!header || !fallbackYear) return [];
  const products = new Map<string, {
    label: string;
    durationDays: number;
    prices: Map<string, { entry: V3PriceCalendarEntry; specificity: number }>;
    sourceNodeIds: Set<string>;
    conflicted: boolean;
  }>();

  for (let row = header.row + 1; row < table.rows; row += 1) {
    const productCell = coveringCell(table, row, header.productColumn);
    const dateCell = coveringCell(table, row, header.dateColumn);
    const amountCell = coveringCell(table, row, header.amountColumn);
    if (!productCell || !dateCell || !amountCell) continue;
    const label = compactProductAxisLabel(productCell.text);
    if (!label || /^(?:상품명|상품구분|패키지명)$/u.test(label.replace(/\s+/gu, ''))) continue;
    if (!productAxisMatchesLocalSection(label, sectionRawText)) continue;
    if (sourcePriceAvailabilityStatus(amountCell.text) !== 'available') continue;
    const price = sourceCellPrice(amountCell.text);
    const dates = dateEntries(dateCell.text, fallbackYear);
    if (!price || price.sourceAmountScale !== 1000 || dates.length === 0) continue;
    const durationDays = durationFromText(label) ?? fallbackDurationDays;
    if (!durationDays) continue;
    const key = label.normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase('ko-KR');
    const target = products.get(key) ?? {
      label,
      durationDays,
      prices: new Map(),
      sourceNodeIds: new Set<string>(),
      conflicted: false,
    };
    target.sourceNodeIds.add(productCell.nodeId);
    target.sourceNodeIds.add(dateCell.nodeId);
    target.sourceNodeIds.add(amountCell.nodeId);
    for (const item of dates) {
      const expandedDates = item.date
        ? [item.date]
        : item.dateRange
          ? datesInInclusiveRange(item.dateRange.start, item.dateRange.end)
          : [];
      const specificity = item.date ? 0 : expandedDates.length;
      for (const date of expandedDates) {
        const entry: V3PriceCalendarEntry = {
          date,
          date_range: null,
          weekday: null,
          label: item.label,
          amount: price.amount,
          currency: 'KRW',
          list_price: price.listPrice,
          price_relation: price.priceRelation,
          evidence: evidence(table, dateCell, amountCell, price.sourceAmountScale),
        };
        const previous = target.prices.get(date);
        if (!previous || specificity < previous.specificity) {
          target.prices.set(date, { entry, specificity });
        } else if (specificity === previous.specificity && previous.entry.amount !== entry.amount) {
          target.conflicted = true;
        }
      }
    }
    products.set(key, target);
  }

  return [...products.values()].flatMap(product => (
    product.conflicted || product.prices.size === 0
      ? []
      : [{
          tableId: table.id,
          durationDays: product.durationDays,
          gradeLabel: product.label,
          productLabelKind: 'package_grade' as const,
          prices: [...product.prices.values()]
            .sort((left, right) => left.entry.date!.localeCompare(right.entry.date!))
            .map(value => value.entry),
          sourceNodeIds: [...product.sourceNodeIds],
        }]
  ));
}

function compactThousandsAmount(value: string): number | null {
  const parsed = parseSourceWonAmount(value.replace(/천\s*원/gu, ''), {
    allowBareSaleShorthand: true,
    minAmount: 100_000,
    maxAmount: 50_000_000,
  });
  return parsed?.sourceAmountScale === 1000 ? parsed.amount : null;
}

function compactGradeLabel(value: string): string | null {
  const label = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (label.length < 2) return null;
  const commercialRole = label
    .replace(/노\s*옵션/gu, '')
    .replace(/노\s*쇼핑/gu, '')
    .replace(/노\s*팁/gu, '');
  if (/(?:성인|아동|소아|유아|싱글|유류|커미션|계약금|데파짓|옵션|현지비|가이드|기사)/u.test(commercialRole)) return null;
  if (/^(?:상품가|판매가|요금|가격|금액)$/u.test(label.replace(/\s+/gu, ''))) return null;
  return label;
}

/**
 * Some land operators write an explicit multi-product price table in units of
 * KRW 1,000 (for example `1,059` means KRW 1,059,000). Scaling is allowed only
 * when a departure-date header, at least two named product columns, and at
 * least two compact prices occur in the same physical table row. The scale is
 * carried on the table-cell evidence so publication can replay it exactly.
 */
function parseCompactThousandsGradeRows(
  table: DocumentIrTable,
  fallbackYear: number | null,
  sectionDurationDays: number | null,
): DocumentIrTablePriceCalendar[] {
  if (!fallbackYear || !sectionDurationDays) return [];
  const rows = Array.from({ length: table.rows }, (_, row) => (
    table.cells.filter(cell => cell.row === row).sort((left, right) => left.column - right.column)
  ));
  const headerIndex = rows.findIndex(cells => cells.some(cell => /출\s*발\s*일/u.test(cell.text)));
  if (headerIndex < 0) return [];
  const headerCells = rows[headerIndex]!;
  const dateHeader = headerCells.find(cell => /출\s*발\s*일/u.test(cell.text));
  if (!dateHeader) return [];
  const labels = new Map<number, string>();
  for (const cell of headerCells) {
    if (cell.id === dateHeader.id) continue;
    const label = compactGradeLabel(cell.text);
    if (label) labels.set(cell.column, label);
  }
  if (labels.size < 2 || new Set(labels.values()).size !== labels.size) return [];

  const byGrade = new Map<string, { prices: V3PriceCalendarEntry[]; sourceNodeIds: Set<string> }>();
  let recognizedRows = 0;
  for (const cells of rows.slice(headerIndex + 1)) {
    const dateCell = cells.find(cell => dateEntries(cell.text, fallbackYear).length > 0);
    if (!dateCell) continue;
    const dates = dateEntries(dateCell.text, fallbackYear);
    let invalidCommercialCell = false;
    const amounts = [...labels.entries()].flatMap(([column, gradeLabel]) => {
      const amountCell = coveringCell(table, dateCell.row, column);
      const amount = amountCell ? compactThousandsAmount(amountCell.text) : null;
      if (!amountCell) {
        invalidCommercialCell = true;
        return [];
      }
      if (sourcePriceAvailabilityStatus(amountCell.text) !== 'available') return [];
      if (!amount) {
        invalidCommercialCell = true;
        return [];
      }
      return [{ gradeLabel, amountCell, amount }];
    });
    if (invalidCommercialCell) return [];
    if (amounts.length === 0) continue;
    recognizedRows += 1;
    for (const { gradeLabel, amountCell, amount } of amounts) {
      const target = byGrade.get(gradeLabel) ?? { prices: [], sourceNodeIds: new Set<string>() };
      for (const item of dates) {
        target.prices.push({
          date: item.date,
          date_range: item.dateRange,
          weekday: null,
          label: item.label,
          amount,
          currency: 'KRW',
          evidence: evidence(table, dateCell, amountCell, 1000),
        });
      }
      target.sourceNodeIds.add(dateCell.nodeId);
      target.sourceNodeIds.add(amountCell.nodeId);
      target.sourceNodeIds.add(headerCells.find(cell => cell.column === amountCell.column)?.nodeId ?? amountCell.nodeId);
      byGrade.set(gradeLabel, target);
    }
  }
  if (recognizedRows === 0) return [];
  return [...byGrade.entries()].map(([gradeLabel, value]) => ({
    tableId: table.id,
    durationDays: sectionDurationDays,
    gradeLabel,
    productLabelKind: 'package_grade',
    prices: value.prices,
    sourceNodeIds: [...value.sourceNodeIds],
  }));
}

export function parseDailyCalendarGrid(
  table: DocumentIrTable,
  sectionDurationDays: number | null,
): DocumentIrTablePriceCalendar[] {
  if (!sectionDurationDays) return [];
  const rows = Array.from({ length: table.rows }, (_, row) => (
    table.cells.filter(cell => cell.row === row).sort((left, right) => left.column - right.column)
  ));
  const prices: V3PriceCalendarEntry[] = [];
  const sourceNodeIds = new Set<string>();
  let currentYear: number | null = null;
  let currentMonth: number | null = null;
  let weekdayByColumn: Map<number, number> | null = null;
  let recognizedMonthCount = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const cells = rows[rowIndex]!;
    const monthCell = cells.find(cell => /^(20\d{2})\s*년\s*(\d{1,2})\s*월(?:\s+[A-Z]{3,12})?\s*$/iu.test(cell.text.normalize('NFKC').trim()));
    if (monthCell) {
      const match = monthCell.text.normalize('NFKC').trim().match(/^(20\d{2})\s*년\s*(\d{1,2})\s*월(?:\s+[A-Z]{3,12})?\s*$/iu)!;
      currentYear = Number(match[1]);
      currentMonth = Number(match[2]);
      weekdayByColumn = null;
      recognizedMonthCount += 1;
      sourceNodeIds.add(monthCell.nodeId);
      continue;
    }
    if (!currentYear || !currentMonth) continue;

    const weekdayCells = cells.flatMap(cell => {
      const label = cell.text.normalize('NFKC').replace(/\s+/gu, '');
      const weekdayLabel = label.match(/^([일월화수목금토])(?:요일)?$/u)?.[1];
      const weekday = weekdayLabel ? WEEKDAYS[weekdayLabel] : null;
      return weekday == null ? [] : [{ cell, weekday }];
    });
    if (weekdayCells.length === 7 && new Set(weekdayCells.map(item => item.weekday)).size === 7) {
      weekdayByColumn = new Map(weekdayCells.map(item => [item.cell.column, item.weekday]));
      weekdayCells.forEach(item => sourceNodeIds.add(item.cell.nodeId));
      continue;
    }
    if (!weekdayByColumn) continue;

    const dateCells = cells.flatMap(cell => {
      if (!weekdayByColumn!.has(cell.column)) return [];
      const value = cell.text.normalize('NFKC').trim();
      if (!/^\d{1,2}$/u.test(value)) return [];
      const day = Number(value);
      return day >= 1 && day <= 31 ? [{ cell, day }] : [];
    });
    if (dateCells.length === 0) continue;
    const priceCells = new Map((rows[rowIndex + 1] ?? []).map(cell => [cell.column, cell]));

    for (const item of dateCells) {
      const date = iso(currentYear, currentMonth, item.day);
      const expectedWeekday = weekdayByColumn.get(item.cell.column);
      if (!date || expectedWeekday == null || new Date(`${date}T00:00:00Z`).getUTCDay() !== expectedWeekday) {
        return [];
      }
      const amountCell = priceCells.get(item.cell.column);
      const amountText = amountCell?.text.normalize('NFKC').trim() ?? '';
      if (!amountText || amountText === '-' || sourcePriceAvailabilityStatus(amountText) !== 'available') continue;
      const price = amountCell ? sourceCellPrice(amountText) : null;
      if (!amountCell || !price) return [];
      prices.push({
        date,
        date_range: null,
        weekday: null,
        label: `${currentMonth}/${item.day}`,
        amount: price.amount,
        currency: 'KRW',
        list_price: price.listPrice,
        price_relation: price.priceRelation,
        evidence: evidence(table, item.cell, amountCell, price.sourceAmountScale),
      });
      sourceNodeIds.add(item.cell.nodeId);
      sourceNodeIds.add(amountCell.nodeId);
    }
  }

  if (recognizedMonthCount === 0 || prices.length === 0) return [];
  return [{
    tableId: table.id,
    durationDays: sectionDurationDays,
    gradeLabel: null,
    prices: prices.sort((left, right) => String(left.date).localeCompare(String(right.date))),
    sourceNodeIds: [...sourceNodeIds],
  }];
}

function bareDaysFromMonthlyRoster(value: string): number[] {
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || /(?:\uC774\uD6C4|\uC774\uC804|\uBB38\uC758|\uC81C\uC678)/u.test(normalized)) return [];
  const cleaned = normalized
    .replace(/\d{1,2}\s*\([^)]*\uB9C8\uAC10[^)]*\)/gu, ' ')
    .replace(/\d{1,2}\s*\uB9C8\uAC10/gu, ' ')
    .replace(/(?:\uD2B9\uAC00|\uC2A4\uD31F|\uC9C0\uC815\uC77C)/gu, ' ')
    .replace(/[\u2605\u2606()[\]{}]/gu, ' ')
    .trim();
  if (!cleaned) return [];
  // Monthly roster cells contain only day numbers, separators and optional
  // Korean weekday labels (for example `25, 26, 27 \uC6D4-\uC218`). Any other
  // wording makes the cell ambiguous and therefore ineligible.
  if (cleaned.replace(/[\d\s,\u00B7.\-~\u301C\uC77C\uC6D4\uD654\uC218\uBAA9\uAE08\uD1A0]/gu, '').length > 0) return [];
  const days = [...cleaned.matchAll(/\d{1,2}/gu)]
    .map(match => Number(match[0]))
    .filter(day => day >= 1 && day <= 31);
  return [...new Set(days)];
}

function annotatedDepartureDaysFromMonthlyRoster(value: string): number[] {
  const cleaned = value.normalize('NFKC')
    .replace(/(?:실속|품격|고품격)?\s*(?:출발)?\s*(?:확정|모객)(?:일)?/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return bareDaysFromMonthlyRoster(cleaned);
}

function coveringCell(table: DocumentIrTable, row: number, column: number): DocumentIrTableCell | null {
  return table.cells.find(cell => (
    cell.row <= row
    && row < cell.row + Math.max(1, cell.rowSpan)
    && cell.column <= column
    && column < cell.column + Math.max(1, cell.colSpan)
  )) ?? null;
}

function splitProductHeaderLabels(value: string): string[] {
  const normalized = value.normalize('NFKC').trim();
  // `A / B 또는 동급` is one supplier-assigned lodging pool. It is not a
  // customer-selectable hotel axis unless the source gives hotel-specific
  // rows or prices. Preserve the pool wording as a single unconfirmed stay.
  if (/(?:또는|OR)\s*동급/iu.test(normalized)) return [normalized.replace(/\s+/gu, ' ')];
  return normalized
    .split(/\r?\n|\s*\/\s*|\s+(?:OR|또는)\s+/giu)
    .map(label => label.replace(/\s+/gu, ' ').trim())
    .filter(label => label.length >= 2 && label.length <= 60)
    .filter(label => !/(?:날짜|출발일|상품가|판매가|요금|가격|성인|아동|싱글|커미션|현지비)/u.test(label))
    .filter(label => sourceCellPrice(label) == null && !/^\d{1,2}\s*(?:월|일|박)$/u.test(label));
}

function productLabelKind(label: string): 'hotel' | 'lodging_grade' {
  return /(?:\d\s*성급|성급\s*호텔)/u.test(label) ? 'lodging_grade' : 'hotel';
}

/**
 * Reads hotel-column rosters shaped as `month | day | nights | hotel A |
 * hotel B`. Merged month/night cells remain active only inside their physical
 * row span. A header containing multiple hotel names produces independent
 * product axes that intentionally share the same price column.
 */
function parseHotelColumnMonthlyRoster(
  table: DocumentIrTable,
  fallbackYear: number | null,
  sectionRawText: string,
): DocumentIrTablePriceCalendar[] {
  if (!fallbackYear) return [];
  const dayDelta = durationDeltaFromText(`${sectionRawText}\n${table.cells.map(cell => cell.text).join('\n')}`);
  if (!dayDelta) return [];

  let headerRow = -1;
  let productColumns = new Map<number, string[]>();
  for (let row = 0; row < table.rows; row += 1) {
    const cells = table.cells.filter(cell => cell.row === row).sort((left, right) => left.column - right.column);
    if (!cells.some(cell => /(?:날짜|출발일)/u.test(cell.text))) continue;
    const labels = new Map<number, string[]>();
    for (const cell of cells) {
      const values = splitProductHeaderLabels(cell.text);
      if (values.length > 0) labels.set(cell.column, values);
    }
    const flattened = [...labels.values()].flat();
    if (flattened.length < 2 || !flattened.some(label => /(?:호텔|리조트|헤난|코스트|타왈라|알로나|성급)/u.test(label))) continue;
    headerRow = row;
    productColumns = labels;
    break;
  }
  if (headerRow < 0 || productColumns.size === 0) return [];

  type RosterTarget = {
    durationDays: number;
    label: string;
    kind: 'hotel' | 'lodging_grade';
    pricesByDate: Map<string, V3PriceCalendarEntry>;
    sourceNodeIds: Set<string>;
  };
  const targets = new Map<string, RosterTarget>();
  const firstProductColumn = Math.min(...productColumns.keys());
  let recognizedRows = 0;

  for (let row = headerRow + 1; row < table.rows; row += 1) {
    const monthCell = table.cells.find(cell => (
      cell.row <= row
      && row < cell.row + Math.max(1, cell.rowSpan)
      && cell.column < firstProductColumn
      && /^\s*\d{1,2}\s*월\s*$/u.test(cell.text.normalize('NFKC'))
    ));
    const nightCell = table.cells.find(cell => (
      cell.row <= row
      && row < cell.row + Math.max(1, cell.rowSpan)
      && cell.column < firstProductColumn
      && /^\s*\d{1,2}\s*박\s*$/u.test(cell.text.normalize('NFKC'))
    ));
    const month = Number(monthCell?.text.match(/\d{1,2}/u)?.[0]);
    const durationDays = durationFromNights(nightCell?.text ?? '', dayDelta);
    if (!monthCell || !nightCell || month < 1 || month > 12 || !durationDays) continue;

    const rowCells = table.cells.filter(cell => cell.row === row && cell.column < firstProductColumn);
    const dayCell = rowCells.find(cell => cell.id !== monthCell.id && cell.id !== nightCell.id && bareDaysFromMonthlyRoster(cell.text).length > 0);
    const days = dayCell ? bareDaysFromMonthlyRoster(dayCell.text) : [];
    if (!dayCell || days.length === 0) continue;

    let rowHasEveryProductPrice = true;
    const pricedColumns = [...productColumns.entries()].flatMap(([column, labels]) => {
      const amountCell = coveringCell(table, row, column);
      const price = amountCell ? sourceCellPrice(amountCell.text) : null;
      if (!amountCell) {
        rowHasEveryProductPrice = false;
        return [];
      }
      if (sourcePriceAvailabilityStatus(amountCell.text) !== 'available') return [];
      if (!price) {
        rowHasEveryProductPrice = false;
        return [];
      }
      return labels.map(label => ({ column, label, amountCell, price }));
    });
    if (!rowHasEveryProductPrice || pricedColumns.length === 0) continue;
    recognizedRows += 1;

    for (const { column, label, amountCell, price } of pricedColumns) {
      const kind = productLabelKind(label);
      const key = `${durationDays}|${kind}|${label}`;
      const target = targets.get(key) ?? {
        durationDays,
        label,
        kind,
        pricesByDate: new Map<string, V3PriceCalendarEntry>(),
        sourceNodeIds: new Set<string>(),
      };
      for (const day of days) {
        const date = iso(fallbackYear, month, day);
        if (!date) return [];
        const entry: V3PriceCalendarEntry = {
          date,
          date_range: null,
          weekday: null,
          label: `${month}/${day}`,
          amount: price.amount,
          currency: 'KRW',
          list_price: price.listPrice,
          price_relation: price.priceRelation,
          evidence: evidence(table, dayCell, amountCell, price.sourceAmountScale),
        };
        const previous = target.pricesByDate.get(date);
        if (previous && previous.amount !== entry.amount) return [];
        target.pricesByDate.set(date, previous ?? entry);
      }
      const headerCell = coveringCell(table, headerRow, column);
      [monthCell, nightCell, dayCell, amountCell, headerCell].filter(Boolean).forEach(cell => target.sourceNodeIds.add(cell!.nodeId));
      targets.set(key, target);
    }
  }

  if (recognizedRows === 0) return [];
  return [...targets.values()].map(target => ({
    tableId: table.id,
    durationDays: target.durationDays,
    gradeLabel: target.label,
    productLabelKind: target.kind,
    prices: [...target.pricesByDate.values()].sort((left, right) => String(left.date).localeCompare(String(right.date))),
    sourceNodeIds: [...target.sourceNodeIds],
  }));
}

function parseInlineLabeledProductPrices(
  table: DocumentIrTable,
  fallbackYear: number | null,
  sectionDurationDays: number | null,
): DocumentIrTablePriceCalendar[] {
  if (!fallbackYear || !sectionDurationDays) return [];
  const rows = Array.from({ length: table.rows }, (_, row) => (
    table.cells.filter(cell => cell.row === row).sort((left, right) => left.column - right.column)
  ));
  const datedCells = rows.flatMap(cells => cells.map(cell => ({ cell, dates: dateEntries(cell.text, fallbackYear) })))
    .filter(item => item.dates.length > 0);
  const priceRows = rows.filter(cells => cells.some(cell => /(?:판\s*매\s*가\s*격|여\s*행\s*경\s*비|상\s*품\s*가\s*격|상\s*품\s*가)/u.test(cell.text)));
  if (priceRows.length !== 1) return [];
  const exactDates = [...new Set(datedCells.flatMap(item => item.dates.map(date => date.date).filter(Boolean)))];
  if (exactDates.length !== 1 || datedCells.some(item => item.dates.some(date => date.dateRange))) return [];
  const dated = datedCells.find(item => priceRows[0]!.some(cell => cell.id === item.cell.id)) ?? datedCells[0];
  if (!dated) return [];
  const amountCells = priceRows[0]!.filter(cell => extractSourceWonAmounts(cell.text, {
    allowBareSaleShorthand: true,
    minAmount: 100_000,
    maxAmount: 50_000_000,
  }).length >= 2);
  if (amountCells.length !== 1) return [];
  const amountCell = amountCells[0]!;
  const labeled = amountCell.text.normalize('NFKC').split(/\r?\n/u).flatMap(line => {
    const match = line.match(/^\s*([^:：]{2,60})\s*[:：]\s*(.+?)\s*$/u);
    if (!match || !/(?:호텔|리조트|성급)/u.test(match[1]!)) return [];
    const price = sourceCellPrice(match[2]!);
    const label = match[1]!.replace(/\s+/gu, ' ').trim();
    return price ? [{ label, price }] : [];
  });
  if (labeled.length < 2 || new Set(labeled.map(item => item.label)).size !== labeled.length) return [];
  return labeled.map(({ label, price }) => ({
    tableId: table.id,
    durationDays: sectionDurationDays,
    gradeLabel: label,
    productLabelKind: productLabelKind(label),
    prices: dated.dates.map(item => ({
      date: item.date,
      date_range: item.dateRange,
      weekday: null,
      label: item.label,
      amount: price.amount,
      currency: 'KRW',
      list_price: price.listPrice,
      price_relation: price.priceRelation,
      evidence: evidence(table, dated.cell, amountCell, price.sourceAmountScale),
    })),
    sourceNodeIds: [dated.cell.nodeId, amountCell.nodeId],
  }));
}

function parseInlineLabeledProductPriceRows(
  table: DocumentIrTable,
  fallbackYear: number | null,
  sectionDurationDays: number | null,
): DocumentIrTablePriceCalendar[] {
  const tableText = table.cells.map(cell => cell.text).join('\n');
  const year = sourceYearFromText(tableText) ?? fallbackYear;
  if (!year || !sectionDurationDays) return [];
  if (!/(?:판\s*매\s*가\s*격|여\s*행\s*경\s*비|상\s*품\s*가\s*격|상\s*품\s*가)/u.test(tableText)) return [];

  const byLabel = new Map<string, {
    kind: 'hotel' | 'lodging_grade';
    prices: Map<string, V3PriceCalendarEntry>;
    sourceNodeIds: Set<string>;
  }>();
  let expectedLabels: string[] | null = null;
  let recognizedRows = 0;

  for (let row = 0; row < table.rows; row += 1) {
    const rowCells = table.cells.filter(cell => cell.row === row).sort((left, right) => left.column - right.column);
    const dateCells = rowCells
      .map(cell => ({ cell, dates: dateEntries(cell.text, year) }))
      .filter(item => item.dates.length > 0 && item.dates.every(date => Boolean(date.date) && !date.dateRange));
    if (dateCells.length !== 1) continue;
    const amountCells = rowCells.filter(cell => extractSourceWonAmounts(cell.text, {
      allowBareSaleShorthand: true,
      minAmount: 100_000,
      maxAmount: 50_000_000,
    }).length >= 2);
    if (amountCells.length !== 1) continue;
    const amountCell = amountCells[0]!;
    const labeled = amountCell.text.normalize('NFKC').split(/\r?\n/u).flatMap(line => {
      const match = line.match(/^\s*([^:：]{2,60})\s*[:：]\s*(.+?)\s*$/u);
      if (!match || !/(?:호텔|리조트|성급)/u.test(match[1]!)) return [];
      const price = sourceCellPrice(match[2]!);
      const label = match[1]!.replace(/\s+/gu, ' ').trim();
      return price ? [{ label, price }] : [];
    });
    if (labeled.length < 2 || new Set(labeled.map(item => item.label)).size !== labeled.length) continue;
    const labels = labeled.map(item => item.label).sort((left, right) => left.localeCompare(right, 'ko'));
    if (expectedLabels && (labels.length !== expectedLabels.length || labels.some((label, index) => label !== expectedLabels![index]))) {
      return [];
    }
    expectedLabels = labels;
    const commercialScopeCell = Array.from({ length: table.columns }, (_, column) => coveringCell(table, row, column))
      .find(cell => cell && /(?:판\s*매\s*가\s*격|여\s*행\s*경\s*비|상\s*품\s*가\s*격|상\s*품\s*가)/u.test(cell.text));
    if (!commercialScopeCell) continue;

    const dated = dateCells[0]!;
    for (const { label, price } of labeled) {
      const target = byLabel.get(label) ?? {
        kind: productLabelKind(label),
        prices: new Map<string, V3PriceCalendarEntry>(),
        sourceNodeIds: new Set<string>(),
      };
      for (const item of dated.dates) {
        const date = item.date!;
        const entry: V3PriceCalendarEntry = {
          date,
          date_range: null,
          weekday: null,
          label: item.label,
          amount: price.amount,
          currency: 'KRW',
          list_price: price.listPrice,
          price_relation: price.priceRelation,
          evidence: evidence(table, dated.cell, amountCell, price.sourceAmountScale),
        };
        const previous = target.prices.get(date);
        if (previous && previous.amount !== entry.amount) return [];
        target.prices.set(date, previous ?? entry);
      }
      target.sourceNodeIds.add(commercialScopeCell.nodeId);
      target.sourceNodeIds.add(dated.cell.nodeId);
      target.sourceNodeIds.add(amountCell.nodeId);
      byLabel.set(label, target);
    }
    recognizedRows += 1;
  }

  if (recognizedRows === 0 || byLabel.size < 2) return [];
  return [...byLabel.entries()].map(([gradeLabel, value]) => ({
    tableId: table.id,
    durationDays: sectionDurationDays,
    gradeLabel,
    productLabelKind: value.kind,
    prices: [...value.prices.values()].sort((left, right) => String(left.date).localeCompare(String(right.date))),
    sourceNodeIds: [...value.sourceNodeIds],
  }));
}

function parseExplicitDatePriceRows(
  table: DocumentIrTable,
  fallbackYear: number | null,
  sectionDurationDays: number | null,
): DocumentIrTablePriceCalendar[] {
  if (!fallbackYear || !sectionDurationDays) return [];
  const tableText = table.cells.map(cell => cell.text).join('\n');
  if (!/출\s*발\s*일/u.test(tableText) || !/(?:판\s*매\s*가|상\s*품\s*가|여\s*행\s*경\s*비)/u.test(tableText)) return [];
  const year = sourceYearFromText(tableText) ?? fallbackYear;
  const explicitProductDurations = Array.from({ length: table.rows }, (_, row) => (
    table.cells.filter(cell => cell.row === row)
  )).flatMap(cells => {
    const durationDays = rowDurationFromCells(cells);
    return durationDays
      && cells.some(cell => dateEntries(cell.text, year).length > 0)
      && cells.some(cell => sourceCellPrice(cell.text) != null)
      ? [durationDays]
      : [];
  });
  // This reader intentionally owns only one-product tables. When the same
  // physical table carries multiple duration products, parseTable keeps the
  // active merged product cell and binds each row to its own duration. Mapping
  // every row to sectionDurationDays here would leak 4박6일 prices into a
  // neighboring 3박5일 product.
  if (new Set(explicitProductDurations).size >= 2) return [];
  const pricesByDate = new Map<string, V3PriceCalendarEntry>();
  const sourceNodeIds = new Set<string>();
  let recognizedRows = 0;
  for (let row = 0; row < table.rows; row += 1) {
    const cells = table.cells.filter(cell => cell.row === row).sort((left, right) => left.column - right.column);
    const coveredCells = table.cells.filter(cell => (
      cell.row <= row && row < cell.row + Math.max(1, cell.rowSpan)
    ));
    const rowText = cells.map(cell => cell.text).join(' ');
    if (/(?:싱글|아동|소아|유아|커미션|계약금|데파짓|옵션|현지비)/u.test(rowText)) continue;
    const dated = cells.filter(cell => sourceCellPrice(cell.text) == null)
      .map(cell => ({ cell, dates: dateEntries(cell.text, year) }))
      .filter(item => item.dates.length > 0);
    const amountCells = coveredCells.filter(cell => sourceCellPrice(cell.text) != null);
    const combined = cells.map(cell => ({
      cell,
      dates: dateEntries(cell.text, year),
      price: sourceCellPrice(cell.text),
    })).filter(item => item.dates.length > 0 && item.price != null);
    const rowBinding = dated.length === 1 && amountCells.length === 1
      ? { dateCell: dated[0]!.cell, amountCell: amountCells[0]!, dates: dated[0]!.dates }
      : combined.length === 1 && amountCells.length === 1
        ? {
            dateCell: combined[0]!.cell,
            amountCell: combined[0]!.cell,
            dates: combined[0]!.dates,
          }
        : null;
    if (!rowBinding || rowBinding.dates.some(item => !item.date || item.dateRange)) continue;
    const price = sourceCellPrice(rowBinding.amountCell.text);
    if (!price) continue;
    recognizedRows += 1;
    for (const item of rowBinding.dates) {
      const entry: V3PriceCalendarEntry = {
        date: item.date,
        date_range: null,
        weekday: null,
        label: item.label,
        amount: price.amount,
        currency: 'KRW',
        list_price: price.listPrice,
        price_relation: price.priceRelation,
        evidence: evidence(table, rowBinding.dateCell, rowBinding.amountCell, price.sourceAmountScale),
      };
      const previous = pricesByDate.get(item.date!);
      if (previous && previous.amount !== entry.amount) return [];
      pricesByDate.set(item.date!, previous ?? entry);
    }
    sourceNodeIds.add(rowBinding.dateCell.nodeId);
    sourceNodeIds.add(rowBinding.amountCell.nodeId);
  }
  if (recognizedRows < 2 || pricesByDate.size < 2) return [];
  return [{
    tableId: table.id,
    durationDays: sectionDurationDays,
    gradeLabel: null,
    prices: [...pricesByDate.values()].sort((left, right) => String(left.date).localeCompare(String(right.date))),
    sourceNodeIds: [...sourceNodeIds],
  }];
}

/**
 * Reads supplier grids shaped as repeated `month | day-list | price |
 * day-list | price` pairs. Month cells commonly span several physical rows,
 * so the active month is carried only inside this table. A date and amount are
 * accepted exclusively from adjacent cells in the same EvidenceIR row.
 */
function parsePairedMonthDayPriceGrid(
  table: DocumentIrTable,
  fallbackYear: number | null,
  sectionDurationDays: number | null,
): DocumentIrTablePriceCalendar[] {
  if (!fallbackYear || !sectionDurationDays) return [];
  const rows = Array.from({ length: table.rows }, (_, row) => (
    table.cells.filter(cell => cell.row === row).sort((left, right) => left.column - right.column)
  ));
  const targets = new Map<number, {
    byDate: Map<string, V3PriceCalendarEntry>;
    sourceNodeIds: Set<string>;
    currentMonth: number | null;
    recognizedMonthCount: number;
    recognizedPairCount: number;
    durationProvenByRowSpan: boolean;
  }>();
  const monthCandidates = table.cells.filter(cell => /^\s*\d{1,2}\s*\uC6D4\s*$/u.test(cell.text.normalize('NFKC')));
  const monthCountsByColumn = monthCandidates.reduce<Map<number, number>>((counts, cell) => (
    counts.set(cell.column, (counts.get(cell.column) ?? 0) + 1)
  ), new Map());
  const rankedMonthColumns = [...monthCountsByColumn.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0]);
  const monthColumn = rankedMonthColumns[0]?.[0] ?? null;
  const monthColumnCount = rankedMonthColumns[0]?.[1] ?? 0;
  if (monthColumn == null || monthColumnCount === rankedMonthColumns[1]?.[1]) return [];
  if (monthColumnCount < 2 && !monthCandidates.some(cell => cell.column === monthColumn && cell.rowSpan > 1)) return [];

  for (const [row, cells] of rows.entries()) {
    const coveredCells = table.cells.filter(cell => (
      cell.row <= row && row < cell.row + Math.max(1, cell.rowSpan)
    ));
    const durationCells = coveredCells.filter(cell => (
      cell.rowSpan > 1
      || /\d{1,2}\s*\uBC15\s*\d{1,2}\s*\uC77C/u.test(cell.text.normalize('NFKC'))
    ));
    const provenDuration = rowDurationFromCells(durationCells);
    const durationDays = provenDuration ?? sectionDurationDays;
    const target = targets.get(durationDays) ?? {
      byDate: new Map<string, V3PriceCalendarEntry>(),
      sourceNodeIds: new Set<string>(),
      currentMonth: null,
      recognizedMonthCount: 0,
      recognizedPairCount: 0,
      durationProvenByRowSpan: false,
    };
    if (provenDuration) {
      target.durationProvenByRowSpan = true;
      durationCells.filter(cell => rowDurationFromCells([cell]) === provenDuration)
        .forEach(cell => target.sourceNodeIds.add(cell.nodeId));
    }
    const monthCell = cells.find(cell => (
      cell.column === monthColumn
      && /^\s*(\d{1,2})\s*\uC6D4\s*$/u.test(cell.text.normalize('NFKC'))
    ));
    if (monthCell) {
      const month = Number(monthCell.text.normalize('NFKC').match(/\d{1,2}/u)?.[0]);
      if (month >= 1 && month <= 12) {
        target.currentMonth = month;
        target.recognizedMonthCount += 1;
        target.sourceNodeIds.add(monthCell.nodeId);
      }
    }
    if (!target.currentMonth) {
      targets.set(durationDays, target);
      continue;
    }
    const byColumn = new Map(cells.map(cell => [cell.column, cell]));
    for (const amountCell of cells) {
      const price = sourceCellPrice(amountCell.text);
      if (!price) continue;
      const dateCell = byColumn.get(amountCell.column - 1);
      if (!dateCell) continue;
      const days = bareDaysFromMonthlyRoster(dateCell.text);
      if (days.length === 0) continue;
      target.recognizedPairCount += 1;
      for (const day of days) {
        const date = iso(fallbackYear, target.currentMonth, day);
        if (!date) return [];
        const entry: V3PriceCalendarEntry = {
          date,
          date_range: null,
          weekday: null,
          label: `${target.currentMonth}/${day}`,
          amount: price.amount,
          currency: 'KRW',
          list_price: price.listPrice,
          price_relation: price.priceRelation,
          evidence: evidence(table, dateCell, amountCell, price.sourceAmountScale),
        };
        const previous = target.byDate.get(date);
        if (previous && previous.amount !== price.amount) return [];
        target.byDate.set(date, previous ?? entry);
        target.sourceNodeIds.add(dateCell.nodeId);
        target.sourceNodeIds.add(amountCell.nodeId);
      }
    }
    targets.set(durationDays, target);
  }

  const valid = [...targets.entries()].filter(([, target]) => (
    target.recognizedMonthCount > 0
    && target.recognizedPairCount >= 2
    && target.byDate.size > 0
  ));
  const hasMultipleProvenDurations = new Set(valid
    .filter(([, target]) => target.durationProvenByRowSpan)
    .map(([durationDays]) => durationDays)).size >= 2;
  return valid.map(([durationDays, target]) => ({
    tableId: table.id,
    durationDays,
    gradeLabel: null,
    productLabelKind: hasMultipleProvenDurations ? 'duration' : null,
    prices: [...target.byDate.values()].sort((left, right) => String(left.date).localeCompare(String(right.date))),
    sourceNodeIds: [...target.sourceNodeIds],
  }));
}

/**
 * Reads supplier tables where the left-most date range is only a visual group
 * label and the actual sale dates live in a second, amount-adjacent roster.
 *
 * Example:
 *   8/17~8/31 | 월, 수 (8/17,19,24,26,31) | 649,000
 *              | 특가 8/18, 8/30           | 679,000
 *
 * Expanding the row-spanned group range with the first amount creates phantom
 * prices and false same-date conflicts. This reader therefore accepts only
 * exact dates from the local roster and uses the wider range as context.
 */
function localRosterDateEntries(value: string, year: number): ReturnType<typeof dateEntries> {
  const normalized = value.normalize('NFKC').trim();
  const fragments = new Set<string>([normalized]);
  for (const match of normalized.matchAll(/\(([^)]*\d{1,2}\s*\/\s*\d{1,2}[^)]*)\)/gu)) {
    fragments.add(match[1]!.trim());
  }
  const firstDateIndex = normalized.search(/\d{1,2}\s*\/\s*\d{1,2}/u);
  if (firstDateIndex >= 0) fragments.add(normalized.slice(firstDateIndex).replace(/[)\s]+$/gu, '').trim());
  const exact = [...fragments].flatMap(fragment => dateEntries(fragment, year))
    .filter(entry => entry.date != null && entry.dateRange == null);
  return [...new Map(exact.map(entry => [entry.date!, entry])).values()];
}

function parseGroupedRangeLocalRosterPriceTable(
  table: DocumentIrTable,
  fallbackYear: number | null,
  sectionDurationDays: number | null,
): DocumentIrTablePriceCalendar[] {
  if (!fallbackYear || !sectionDurationDays) return [];
  const tableYear = sourceYearFromText(table.cells.map(cell => cell.text).join('\n')) ?? fallbackYear;
  const byDate = new Map<string, { entry: V3PriceCalendarEntry; specificity: number }>();
  const datesWithoutNumericPrice = new Set<string>();
  const sourceNodeIds = new Set<string>();
  let groupedBindings = 0;
  let recognizedRows = 0;

  for (let row = 0; row < table.rows; row += 1) {
    const cells = table.cells.filter(cell => cell.row === row).sort((left, right) => left.column - right.column);
    const coveredCells = table.cells.filter(cell => (
      cell.row <= row && row < cell.row + Math.max(1, cell.rowSpan)
    ));
    const amountCells = cells.filter(cell => sourceCellPrice(cell.text) != null);
    if (amountCells.length !== 1) continue;
    const amountCell = amountCells[0]!;
    const exactRosterCandidates = cells
      .filter(cell => cell.id !== amountCell.id)
      .map(cell => ({
        cell,
        dates: localRosterDateEntries(cell.text, tableYear),
      }))
      .filter(candidate => candidate.dates.length > 0);
    if (exactRosterCandidates.length === 0) continue;
    const localRoster = [...exactRosterCandidates].sort((left, right) => {
      const distance = Math.abs(left.cell.column - amountCell.column) - Math.abs(right.cell.column - amountCell.column);
      if (distance !== 0) return distance;
      if (left.cell.rowSpan !== right.cell.rowSpan) return left.cell.rowSpan - right.cell.rowSpan;
      return right.cell.column - left.cell.column;
    })[0]!;
    const groupRange = coveredCells.find(cell => (
      cell.id !== localRoster.cell.id
      && cell.id !== amountCell.id
      && dateEntries(cell.text, tableYear).some(date => date.dateRange != null)
    ));
    if (!groupRange) continue;
    groupedBindings += 1;

    const exactDates = [...new Set(localRoster.dates
      .map(date => date.date)
      .filter((date): date is string => Boolean(date)))];
    if (exactDates.length === 0) continue;
    const rowText = cells.map(cell => cell.text).join(' ').normalize('NFKC');
    const availability = sourcePriceAvailabilityStatus(rowText);
    if (availability === 'inquiry' || availability === 'sold_out' || availability === 'not_operating') {
      exactDates.forEach(date => datesWithoutNumericPrice.add(date));
      continue;
    }
    const price = sourceCellPrice(amountCell.text);
    if (!price) continue;
    recognizedRows += 1;
    const isExplicitOverride = /(?:특가|제외\s*일자|연휴|성수기|특송)/u.test(rowText);
    const specificity = isExplicitOverride ? 0 : exactDates.length;
    for (const date of exactDates) {
      const entry: V3PriceCalendarEntry = {
        date,
        date_range: null,
        weekday: null,
        label: date,
        amount: price.amount,
        currency: 'KRW',
        list_price: price.listPrice,
        price_relation: price.priceRelation,
        evidence: evidence(table, localRoster.cell, amountCell, price.sourceAmountScale),
      };
      const previous = byDate.get(date);
      if (!previous || specificity < previous.specificity) {
        byDate.set(date, { entry, specificity });
      } else if (specificity === previous.specificity && previous.entry.amount !== entry.amount) {
        return [];
      }
    }
    [groupRange, localRoster.cell, amountCell].forEach(cell => sourceNodeIds.add(cell.nodeId));
  }

  datesWithoutNumericPrice.forEach(date => byDate.delete(date));
  if (groupedBindings === 0 || recognizedRows < 2 || byDate.size === 0) return [];
  return [{
    tableId: table.id,
    durationDays: sectionDurationDays,
    gradeLabel: null,
    productLabelKind: null,
    prices: [...byDate.values()]
      .map(value => value.entry)
      .sort((left, right) => String(left.date).localeCompare(String(right.date))),
    sourceNodeIds: [...sourceNodeIds],
  }];
}

/**
 * Reads a multi-duration supplier grid shaped as
 * `출발일(row/column span) | 패턴(수 3박5일) | 상품가`.
 *
 * The spanned date range belongs independently to every covered pattern row.
 * `3박5일` and `4박6일` are separate products, while exact `제외일` rows are
 * price overrides for the matching duration product. Treating the first
 * duration as a section-wide fallback drops valid future prices from the
 * neighboring duration product.
 */
function parseDurationPatternRangePriceTable(
  table: DocumentIrTable,
  fallbackYear: number | null,
): DocumentIrTablePriceCalendar[] {
  if (!fallbackYear) return [];
  let header: {
    row: number;
    dateColumnStart: number;
    dateColumnEnd: number;
    patternColumn: number;
    amountColumn: number;
  } | null = null;
  for (let row = 0; row < table.rows; row += 1) {
    const cells = table.cells.filter(cell => cell.row === row).sort((left, right) => left.column - right.column);
    const compact = (cell: DocumentIrTableCell) => cell.text.normalize('NFKC').replace(/\s+/gu, '');
    const dateHeader = cells.find(cell => /^(?:출발일|출발기간|기간)$/u.test(compact(cell)));
    const patternHeader = cells.find(cell => /^(?:패턴|일정패턴)$/u.test(compact(cell)));
    if (!dateHeader || !patternHeader) continue;
    const amountCandidates = cells.filter(cell => cell.column > patternHeader.column);
    if (amountCandidates.length !== 1) continue;
    header = {
      row,
      dateColumnStart: dateHeader.column,
      dateColumnEnd: dateHeader.column + Math.max(1, dateHeader.colSpan),
      patternColumn: patternHeader.column,
      amountColumn: amountCandidates[0]!.column,
    };
    break;
  }
  if (!header) return [];

  type Target = {
    pricesByDate: Map<string, { entry: V3PriceCalendarEntry; specificity: number }>;
    datesWithoutNumericPrice: Set<string>;
    sourceNodeIds: Set<string>;
    recognizedRangeRows: number;
  };
  const targets = new Map<number, Target>();

  for (let row = header.row + 1; row < table.rows; row += 1) {
    const rowCells = table.cells.filter(cell => cell.row === row).sort((left, right) => left.column - right.column);
    const patternCell = coveringCell(table, row, header.patternColumn);
    const amountCell = coveringCell(table, row, header.amountColumn);
    const durationDays = patternCell ? rowDurationFromCells([patternCell]) : null;
    if (!patternCell || !amountCell || !durationDays) continue;

    const spannedDateCell = coveringCell(table, row, header.dateColumnStart);
    const localDateCells = rowCells.filter(cell => (
      cell.column >= header!.dateColumnStart
      && cell.column < header!.dateColumnEnd
      && dateEntries(cell.text, fallbackYear).length > 0
    ));
    const dateCell = localDateCells[0]
      ?? (spannedDateCell && dateEntries(spannedDateCell.text, fallbackYear).length > 0 ? spannedDateCell : null);
    if (!dateCell) continue;
    const dates = dateEntries(dateCell.text, fallbackYear);
    if (dates.length === 0) continue;

    const target = targets.get(durationDays) ?? {
      pricesByDate: new Map<string, { entry: V3PriceCalendarEntry; specificity: number }>(),
      datesWithoutNumericPrice: new Set<string>(),
      sourceNodeIds: new Set<string>(),
      recognizedRangeRows: 0,
    };
    const weekdays = weekdaysFromDurationPatternLabel(patternCell.text);
    const expanded = dates.flatMap(item => {
      if (item.date) return [item.date];
      if (!item.dateRange || weekdays.length === 0) return [];
      return datesInInclusiveRange(item.dateRange.start, item.dateRange.end)
        .filter(date => weekdays.includes(new Date(`${date}T00:00:00.000Z`).getUTCDay()));
    });
    if (expanded.length === 0) continue;

    const status = sourcePriceAvailabilityStatus(rowCells.map(cell => cell.text).join(' '));
    if (status === 'inquiry' || status === 'sold_out' || status === 'not_operating') {
      expanded.forEach(date => target.datesWithoutNumericPrice.add(date));
      targets.set(durationDays, target);
      continue;
    }
    const price = sourceCellPrice(amountCell.text);
    if (!price) continue;
    const hasRange = dates.some(item => item.dateRange != null);
    if (hasRange) target.recognizedRangeRows += 1;
    const specificity = hasRange ? expanded.length : 0;
    for (const date of expanded) {
      const entry: V3PriceCalendarEntry = {
        date,
        date_range: null,
        weekday: null,
        label: date,
        amount: price.amount,
        currency: 'KRW',
        list_price: price.listPrice,
        price_relation: price.priceRelation,
        evidence: evidence(table, dateCell, amountCell, price.sourceAmountScale),
      };
      const previous = target.pricesByDate.get(date);
      if (!previous || specificity < previous.specificity) {
        target.pricesByDate.set(date, { entry, specificity });
      } else if (specificity === previous.specificity && previous.entry.amount !== entry.amount) {
        return [];
      }
    }
    [dateCell, patternCell, amountCell].forEach(cell => target.sourceNodeIds.add(cell.nodeId));
    targets.set(durationDays, target);
  }

  const validTargets = [...targets.entries()].filter(([, target]) => target.recognizedRangeRows > 0);
  if (validTargets.length < 2) return [];
  return validTargets.flatMap(([durationDays, target]) => {
    target.datesWithoutNumericPrice.forEach(date => target.pricesByDate.delete(date));
    if (target.pricesByDate.size === 0) return [];
    return [{
      tableId: table.id,
      durationDays,
      gradeLabel: null,
      productLabelKind: 'duration' as const,
      prices: [...target.pricesByDate.values()]
        .map(value => value.entry)
        .sort((left, right) => String(left.date).localeCompare(String(right.date))),
      sourceNodeIds: [...target.sourceNodeIds],
    }];
  });
}

function parseTable(table: DocumentIrTable, fallbackYear: number | null): DocumentIrTablePriceCalendar[] {
  const year = sourceYearFromText(table.cells.map(cell => cell.text).join('\n')) ?? fallbackYear;
  if (!year) return [];
  const tableText = table.cells.map(cell => cell.text).join('\n');
  const explicitDurationDateRows = Array.from({ length: table.rows }, (_, row) => (
    table.cells.filter(cell => cell.row === row)
  )).filter(cells => (
    rowDurationFromCells(cells) != null
    && cells.some(cell => dateEntries(cell.text, year).length > 0)
    && cells.some(cell => sourceCellPrice(cell.text) != null)
  ));
  const hasExplicitDurationDateRows = explicitDurationDateRows.length >= 2
    && new Set(explicitDurationDateRows.map(row => rowDurationFromCells(row))).size >= 2;
  if ((!/\uCD9C\s*\uBC1C\s*\uC77C/u.test(tableText) && !hasExplicitDurationDateRows)
    || !table.cells.some(cell => sourceCellPrice(cell.text))) return [];
  const byDuration = new Map<string, {
    durationDays: number;
    gradeLabel: string | null;
    productLabelKind: 'duration' | 'package_grade' | null;
    prices: V3PriceCalendarEntry[];
    sourceNodeIds: Set<string>;
  }>();
  const headers = explicitDepartureGradeHeaders(table);
  let durationDays: number | null = durationFromText(tableText);
  let weekdays: number[] = [];

  for (let row = 0; row < table.rows; row += 1) {
    const cells = table.cells.filter(cell => cell.row === row).sort((left, right) => left.column - right.column);
    const coveredCells = table.cells.filter(cell => (
      cell.row <= row && row < cell.row + Math.max(1, cell.rowSpan)
    ));
    const rowText = cells.map(cell => cell.text).join(' ').normalize('NFKC');
    if (/(?:\uC2F1\uAE00|\uC544\uB3D9|\uC18C\uC544|\uC720\uC544|\uCEE4\uBBF8\uC158|\uACC4\uC57D\uAE08|\uB370\uD30C\uC9D3|\uC635\uC158|\uD604\uC9C0\uBE44)/u.test(rowText)) continue;
    durationDays = rowDurationFromCells(cells) ?? durationDays;
    const rowDays = rowWeekdays(cells);
    if (rowDays.length > 0) weekdays = rowDays;
    if (!durationDays) continue;
    const amountCells = coveredCells.filter(cell => sourceCellPrice(cell.text) != null);
    if (amountCells.length === 0 || (amountCells.length > 1 && headers.size === 0)) continue;
    const dateCell = cells.find(cell => !amountCells.some(amount => amount.id === cell.id) && dateEntries(cell.text, year).length > 0);
    if (!dateCell) continue;
    const dates = dateEntries(dateCell.text, year);
    if (dates.length === 0) continue;
    for (const amountCell of amountCells) {
      const gradeLabel = headers.get(amountCell.column) ?? null;
      if (headers.size > 0 && !gradeLabel) continue;
      const price = sourceCellPrice(amountCell.text);
      if (!price) continue;
      const key = `${durationDays}|${gradeLabel ?? ''}`;
      const target = byDuration.get(key) ?? {
        durationDays,
        gradeLabel,
        productLabelKind: gradeLabel ? 'package_grade' : hasExplicitDurationDateRows ? 'duration' : null,
        prices: [],
        sourceNodeIds: new Set<string>(),
      };
      for (const item of dates) {
        const applicableWeekdays = item.dateRange && weekdays.length > 0 ? weekdays : [null];
        for (const weekday of applicableWeekdays) {
          target.prices.push({
            date: item.date,
            date_range: item.dateRange,
            weekday,
            label: weekday == null ? item.label : `${item.label} ${Object.keys(WEEKDAYS).find(day => WEEKDAYS[day] === weekday) ?? ''}\uC694\uC77C`,
            amount: price.amount,
            currency: 'KRW',
            list_price: price.listPrice,
            price_relation: price.priceRelation,
            evidence: evidence(table, dateCell, amountCell, price.sourceAmountScale),
          });
        }
      }
      target.sourceNodeIds.add(dateCell.nodeId);
      target.sourceNodeIds.add(amountCell.nodeId);
      byDuration.set(key, target);
    }
  }

  return [...byDuration.values()]
    .filter(value => value.prices.length > 0)
    .map(value => ({
      tableId: table.id,
      durationDays: value.durationDays,
      gradeLabel: value.gradeLabel,
      productLabelKind: value.productLabelKind,
      prices: value.prices.sort((left, right) => String(left.date ?? left.date_range?.start ?? '')
        .localeCompare(String(right.date ?? right.date_range?.start ?? ''))),
      sourceNodeIds: [...value.sourceNodeIds],
    }));
}

function parseMonthDayGradeMatrix(
  table: DocumentIrTable,
  fallbackYear: number | null,
): DocumentIrTablePriceCalendar[] {
  const tableText = table.cells.map(cell => cell.text).join('\n');
  const year = sourceYearFromText(tableText) ?? fallbackYear;
  const durationDays = durationFromText(tableText);
  const headers = explicitDepartureGradeHeaders(table);
  if (!year || !durationDays || headers.size === 0) return [];

  let monthColumn: number | null = null;
  let dayColumn: number | null = null;
  let headerRow = -1;
  for (let row = 0; row < table.rows; row += 1) {
    const cells = table.cells.filter(cell => cell.row === row);
    if (!cells.some(cell => headers.has(cell.column))) continue;
    const month = cells.find(cell => cell.text.normalize('NFKC').replace(/\s+/g, '') === '\uC6D4');
    const day = cells.find(cell => cell.text.normalize('NFKC').replace(/\s+/g, '') === '\uC77C');
    if (!month || !day || month.column === day.column) continue;
    monthColumn = month.column;
    dayColumn = day.column;
    headerRow = row;
    break;
  }
  if (monthColumn == null || dayColumn == null || headerRow < 0) return [];

  const byGrade = new Map<string, { prices: V3PriceCalendarEntry[]; sourceNodeIds: Set<string> }>();
  let currentMonth: number | null = null;
  for (let row = headerRow + 1; row < table.rows; row += 1) {
    const cells = table.cells.filter(cell => cell.row === row);
    const monthCell = cells.find(cell => cell.column === monthColumn);
    const monthValue = Number(monthCell?.text.normalize('NFKC').trim());
    if (Number.isInteger(monthValue) && monthValue >= 1 && monthValue <= 12) currentMonth = monthValue;
    const dayCell = cells.find(cell => cell.column === dayColumn);
    const dayValue = Number(dayCell?.text.normalize('NFKC').trim());
    if (!currentMonth || !dayCell || !Number.isInteger(dayValue) || dayValue < 1 || dayValue > 31) continue;
    const date = iso(year, currentMonth, dayValue);
    if (!date) continue;
    for (const [column, gradeLabel] of headers.entries()) {
      const amountCell = coveringCell(table, row, column);
      if (!amountCell) continue;
      if (sourcePriceAvailabilityStatus(amountCell.text) !== 'available') continue;
      const price = sourceCellPrice(amountCell.text);
      if (!price) continue;
      const target = byGrade.get(gradeLabel) ?? { prices: [], sourceNodeIds: new Set<string>() };
      target.prices.push({
        date,
        date_range: null,
        weekday: null,
        label: `${currentMonth}/${dayValue}`,
        amount: price.amount,
        currency: 'KRW',
        list_price: price.listPrice,
        price_relation: price.priceRelation,
        evidence: evidence(table, dayCell, amountCell, price.sourceAmountScale),
      });
      target.sourceNodeIds.add(dayCell.nodeId);
      target.sourceNodeIds.add(amountCell.nodeId);
      if (monthCell) target.sourceNodeIds.add(monthCell.nodeId);
      byGrade.set(gradeLabel, target);
    }
  }

  return [...byGrade.entries()]
    .filter(([, value]) => value.prices.length > 0)
    .map(([gradeLabel, value]) => ({
      tableId: table.id,
      durationDays,
      gradeLabel,
      productLabelKind: 'package_grade',
      prices: value.prices,
      sourceNodeIds: [...value.sourceNodeIds],
    }));
}

/**
 * Reads a decorated supplier matrix where product labels sit one visual cell
 * to the right of their numeric price columns and duration headings divide
 * the same table into independent itinerary products.
 *
 * Example: `Premium` at column 2 owns amounts in column 1, while `Crown` at
 * column 5 owns column 4. A `3박5일` block and a `4박6일` block therefore
 * become four product axes instead of conflicting prices on one product.
 */
function parseDurationGradeDateMatrix(
  table: DocumentIrTable,
  fallbackYear: number | null,
): DocumentIrTablePriceCalendar[] {
  const tableText = table.cells.map(cell => cell.text).join('\n');
  const year = sourceYearFromText(tableText) ?? fallbackYear;
  if (!year) return [];
  const labels = new Map<number, string>();
  for (const cell of table.cells) {
    const text = cell.text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    if (!text || text.length > 120 || sourceCellPrice(text) != null) continue;
    // This layout contract is intentionally limited to the supplier family
    // proven by the Chengdu Premium/Crown source. Generic Korean labels such
    // as "고품격/실속" also occur in unrelated shared price tables; treating
    // them as this matrix leaked dates and prices across split products.
    const english = text.match(/^(Premium|Crown)(?:\s|\/|$)/iu)?.[1];
    const gradeLabel = english
      ? `${english[0]!.toUpperCase()}${english.slice(1).toLowerCase()}`
      : null;
    if (!gradeLabel) continue;
    const previous = labels.get(cell.column);
    if (previous && previous !== gradeLabel) return [];
    labels.set(cell.column, gradeLabel);
  }
  if (labels.size < 2 || new Set(labels.values()).size !== labels.size) return [];

  const datedRows = new Set(table.cells
    .filter(cell => dateEntries(cell.text, year).some(item => item.date != null && item.dateRange == null))
    .map(cell => cell.row));
  if (datedRows.size < 2) return [];
  const amountColumnByLabel = new Map<string, number>();
  const usedAmountColumns = new Set<number>();
  for (const [labelColumn, gradeLabel] of labels) {
    const candidates = [labelColumn, labelColumn - 1, labelColumn - 2]
      .filter(column => column >= 0)
      .map(column => ({
        column,
        count: [...datedRows].filter(row => {
          const cell = coveringCell(table, row, column);
          return cell != null && sourceCellPrice(cell.text) != null;
        }).length,
      }))
      .sort((left, right) => right.count - left.count || Math.abs(left.column - labelColumn) - Math.abs(right.column - labelColumn));
    const selected = candidates[0];
    if (!selected || selected.count < 2 || usedAmountColumns.has(selected.column)) return [];
    amountColumnByLabel.set(gradeLabel, selected.column);
    usedAmountColumns.add(selected.column);
  }

  const targets = new Map<string, {
    durationDays: number;
    gradeLabel: string;
    prices: V3PriceCalendarEntry[];
    sourceNodeIds: Set<string>;
  }>();
  let currentDurationDays: number | null = null;
  for (let row = 0; row < table.rows; row += 1) {
    const rowCells = table.cells.filter(cell => cell.row === row).sort((left, right) => left.column - right.column);
    const rowText = rowCells.map(cell => cell.text).join(' ');
    const rowDurationDays = durationFromText(rowText);
    if (rowDurationDays) currentDurationDays = rowDurationDays;
    if (!currentDurationDays) continue;
    const dated = rowCells
      .map(cell => ({ cell, dates: dateEntries(cell.text, year).filter(item => item.date != null && item.dateRange == null) }))
      .filter(item => item.dates.length > 0);
    if (dated.length !== 1) continue;
    const dateCell = dated[0]!.cell;

    for (const [gradeLabel, amountColumn] of amountColumnByLabel) {
      const amountCell = coveringCell(table, row, amountColumn);
      if (!amountCell || sourcePriceAvailabilityStatus(amountCell.text) !== 'available') continue;
      const price = sourceCellPrice(amountCell.text);
      if (!price) continue;
      const key = `${currentDurationDays}|${gradeLabel}`;
      const target = targets.get(key) ?? {
        durationDays: currentDurationDays,
        gradeLabel,
        prices: [],
        sourceNodeIds: new Set<string>(),
      };
      for (const item of dated[0]!.dates) {
        target.prices.push({
          date: item.date,
          date_range: null,
          weekday: null,
          label: item.label,
          amount: price.amount,
          currency: 'KRW',
          list_price: price.listPrice,
          price_relation: price.priceRelation,
          evidence: evidence(table, dateCell, amountCell, price.sourceAmountScale),
        });
      }
      target.sourceNodeIds.add(dateCell.nodeId);
      target.sourceNodeIds.add(amountCell.nodeId);
      const labelCell = table.cells.find(cell => cell.column >= amountColumn && labels.get(cell.column) === gradeLabel);
      if (labelCell) target.sourceNodeIds.add(labelCell.nodeId);
      targets.set(key, target);
    }
  }

  const calendars = [...targets.values()].filter(target => target.prices.length >= 2);
  if (calendars.length < 2) return [];
  return calendars.map(target => ({
    tableId: table.id,
    durationDays: target.durationDays,
    gradeLabel: target.gradeLabel,
    productLabelKind: 'package_grade',
    prices: target.prices.sort((left, right) => String(left.date).localeCompare(String(right.date))),
    sourceNodeIds: [...target.sourceNodeIds],
  }));
}

export function tableBelongsToSection(table: DocumentIrTable, sectionRawText: string): boolean {
  const normalizedSection = sectionRawText.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const sectionContainsEveryLine = (value: string): boolean => {
    const lines = value.normalize('NFKC')
      .split(/\r?\n/u)
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return lines.length > 0 && lines.every(line => normalizedSection.includes(line));
  };
  const hasTravelPeriodLabel = table.cells.some(cell => /\uC5EC\s*\uD589\s*\uAE30\s*\uAC04/u.test(cell.text));
  const hasWeekdayDepartureScope = table.cells.some(cell => (
    /매\s*주\s*[일월화수목금토](?:\s*요\s*일)?\s*출\s*발/u.test(cell.text)
  ));
  const rowSpannedHeader = rowSpannedProductPriceHeader(table);
  const belongsByRowSpannedProduct = rowSpannedHeader != null && table.cells.some(cell => (
    cell.column === rowSpannedHeader.productColumn
    && cell.row > rowSpannedHeader.row
    && productAxisMatchesLocalSection(cell.text, sectionRawText)
  ));
  const sharedRosterCells = table.cells.filter(cell => sourceDateRosterEntries(cell.text, 2000).length > 0);
  const sharedSaleCells = table.cells.filter(cell => explicitSalePriceFromText(cell.text) != null);
  const sharedRosterHeaderAnchors = table.cells
    .filter(cell => cell.row <= 1 && cell.id !== sharedRosterCells[0]?.id)
    .map(cell => cell.text.normalize('NFKC').replace(/\s+/g, ' ').trim())
    .filter(text => text.length >= 8)
    .filter(text => sourceCellPrice(text) == null);
  const belongsByUniqueSharedRoster = sharedRosterCells.length === 1
    && sharedSaleCells.length === 1
    && !table.cells.some(cell => cell.id !== sharedSaleCells[0]!.id && sourceCellPrice(cell.text) != null)
    // HWP reading order can interleave neighboring header cells between the
    // lines of one multiline date cell. Match every proven roster line rather
    // than requiring those lines to remain adjacent in flattened text.
    && sectionContainsEveryLine(sharedRosterCells[0]!.text)
    && sectionContainsEveryLine(sharedSaleCells[0]!.text)
    // The same dates and price can legitimately occur in two hotel or airline
    // products. A table-local product heading keeps that case separated.
    && (sharedRosterHeaderAnchors.length === 0
      || sharedRosterHeaderAnchors.some(anchor => normalizedSection.includes(anchor)));
  const fullCommercialAnchors = table.cells
    .map(cell => cell.text.normalize('NFKC').replace(/\s+/g, ' ').trim())
    .filter(text => (
      sourceCellPrice(text) != null
      || extractSourceWonAmounts(text, {
        allowBareSaleShorthand: true,
        minAmount: 100_000,
        maxAmount: 50_000_000,
      }).length >= 2
    ));
  const commercialAnchors = table.cells
    .flatMap(cell => cell.text.split(/\r?\n/u))
    .map(text => text.normalize('NFKC').replace(/\s+/g, ' ').trim())
    .filter(text => (
      sourceCellPrice(text) != null
      || extractSourceWonAmounts(text, {
        allowBareSaleShorthand: true,
        minAmount: 100_000,
        maxAmount: 50_000_000,
      }).length >= 2
    ));
  const headerAnchors = table.cells
    .filter(cell => cell.row <= 1)
    .map(cell => cell.text.normalize('NFKC').replace(/\s+/g, ' ').trim())
    .filter(text => text.length >= 8)
    .filter(text => !/(?:출\s*발\s*(?:일\s*자?|날\s*짜)|행\s*사\s*일|여\s*행\s*경\s*비|상\s*품\s*가|판\s*매\s*가|인\s*원)/u.test(text))
    .filter(text => sourceCellPrice(text) == null);
  const hasInlineLabeledProductPriceCell = table.cells.some(cell => {
    const lines = cell.text.normalize('NFKC').split(/\r?\n/u);
    return lines.filter(line => (
      /(?:호텔|리조트|성급)\s*[:：]/u.test(line)
      && extractSourceWonAmounts(line, {
        allowBareSaleShorthand: true,
        minAmount: 100_000,
        maxAmount: 50_000_000,
      }).length === 1
    )).length >= 2;
  });
  const anchors = table.cells
    .map(cell => cell.text.normalize('NFKC').replace(/\s+/g, ' ').trim())
    .filter(text => (
      (/출\s*발\s*(?:일\s*자?|날\s*짜)/u.test(text) && text.length >= 3)
      || (hasTravelPeriodLabel && /\d{1,2}\s*\uC6D4\s*\d{1,2}\s*\uC77C/u.test(text))
      || (hasWeekdayDepartureScope && /\d{1,2}\s*\uC6D4\s*\d{1,2}\s*\uC77C/u.test(text))
      || sourceCellPrice(text) != null
      || extractSourceWonAmounts(text, {
        allowBareSaleShorthand: true,
        minAmount: 100_000,
        maxAmount: 50_000_000,
      }).length >= 2
    ));
  if (belongsByUniqueSharedRoster || belongsByRowSpannedProduct) return true;
  if (anchors.length < 2 || commercialAnchors.length === 0) return false;
  if (fullCommercialAnchors.some(anchor => normalizedSection.includes(anchor))) return true;
  return hasInlineLabeledProductPriceCell
    && commercialAnchors.some(anchor => normalizedSection.includes(anchor))
    && headerAnchors.some(anchor => normalizedSection.includes(anchor));
}

/**
 * Reads date/range/weekday/amount from the same EvidenceIR table row. The
 * result is intentionally conservative: ambiguous multi-price rows are not
 * emitted and flat-text ordering never supplies the evidence.
 */
export function buildDocumentIrTablePriceCalendarCandidates(input: {
  table: DocumentIrTable;
  sectionRawText: string;
  fallbackYear: number | null;
  fallbackDurationDays?: number | null;
}): DocumentIrTablePriceCalendar[] {
  const sectionDurationDays = durationFromText(input.sectionRawText)
    ?? input.fallbackDurationDays
    ?? null;
  const tableDurationDays = durationFromText(input.table.cells.map(cell => cell.text).join('\n'))
    ?? sectionDurationDays;
  const transportGradeDateMatrix = parseTransportGradeDateMatrix(
    input.table,
    input.fallbackYear,
    tableDurationDays,
  );
  if (transportGradeDateMatrix.length > 0) return transportGradeDateMatrix;
  const durationGradeRangeMatrix = parseDurationGradeRangePriceMatrix(
    input.table,
    input.fallbackYear,
  );
  if (durationGradeRangeMatrix.length > 0) return durationGradeRangeMatrix;
  const durationPatternCalendar = parseDurationPatternRangePriceTable(
    input.table,
    input.fallbackYear,
  );
  if (durationPatternCalendar.length > 0) return durationPatternCalendar;
  const authoritativeRangeCalendar = parseRangeWeekdayPriceWithOverrides(
    input.table,
    input.fallbackYear,
    tableDurationDays,
  );
  if (authoritativeRangeCalendar.length > 0) return authoritativeRangeCalendar;
  const groupedRangeRosterCalendar = parseGroupedRangeLocalRosterPriceTable(
    input.table,
    input.fallbackYear,
    tableDurationDays,
  );
  if (groupedRangeRosterCalendar.length > 0) return groupedRangeRosterCalendar;
  const durationGradeMatrix = parseDurationGradeDateMatrix(input.table, input.fallbackYear);
  if (durationGradeMatrix.length > 0) return durationGradeMatrix;
  const inlineLabeledProductPriceRows = parseInlineLabeledProductPriceRows(
    input.table,
    input.fallbackYear,
    tableDurationDays,
  );
  if (inlineLabeledProductPriceRows.length > 0) return inlineLabeledProductPriceRows;
  return [
    ...parseHotelColumnMonthlyRoster(input.table, input.fallbackYear, input.sectionRawText),
    ...parseInlineLabeledProductPrices(input.table, input.fallbackYear, tableDurationDays),
    ...parseSharedDateRosterSalePrice(input.table, input.fallbackYear, tableDurationDays),
    ...parseRowSpannedProductRangePriceTable(
      input.table,
      input.fallbackYear,
      tableDurationDays,
      input.sectionRawText,
    ),
    ...parseExplicitDatePriceRows(input.table, input.fallbackYear, tableDurationDays),
    ...parseDailyCalendarGrid(input.table, tableDurationDays),
    ...parsePairedMonthDayPriceGrid(input.table, input.fallbackYear, tableDurationDays),
    ...parseCompactThousandsGradeRows(input.table, input.fallbackYear, tableDurationDays),
    ...parseCommercialRosterPriceRows(input.table, input.fallbackYear, tableDurationDays),
    ...parseTable(input.table, input.fallbackYear),
    ...parseMonthDayGradeMatrix(input.table, input.fallbackYear),
    ...parseVerticalScalarPrice(input.table, input.fallbackYear, tableDurationDays),
  ];
}

export function buildDocumentIrTablePriceCalendars(input: {
  documentIr: DocumentIR;
  sectionRawText: string;
  fallbackYear?: number | null;
  fallbackDurationDays?: number | null;
}): DocumentIrTablePriceCalendar[] {
  const fallbackYear = sourceYearFromText(input.sectionRawText)
    ?? sourceYearFromText(input.documentIr.filename)
    ?? input.fallbackYear
    ?? null;
  const candidates = input.documentIr.tables
    .filter(table => tableBelongsToSection(table, input.sectionRawText))
    .flatMap(table => buildDocumentIrTablePriceCalendarCandidates({
      table,
      sectionRawText: input.sectionRawText,
      fallbackYear,
      fallbackDurationDays: input.fallbackDurationDays,
    }));
  const grouped = new Map<string, DocumentIrTablePriceCalendar[]>();
  for (const candidate of candidates) {
    // Different conservative readers can recognize the same proven cells.
    // Group by the product identity, then retain the strongest compatible
    // axis label. Keeping parser kind in this key created duplicate calendars
    // and prevented a multi-duration document from expanding into products.
    // Parser candidates from multiple compatible tables still belong to the
    // same semantic price axis and must merge here. Recovery ownership uses
    // documentIrTablePriceCalendarAxisKey(), which additionally retains the
    // source table identity so equal values cannot prove ownership.
    const key = `${candidate.durationDays}|${candidate.transportCode ?? ''}|${candidate.gradeLabel ?? ''}`;
    const values = grouped.get(key) ?? [];
    values.push(candidate);
    grouped.set(key, values);
  }
  return [...grouped.entries()]
    .flatMap(([, values]) => {
      if (values.length === 1) return [values[0]!];
      const productLabelKinds = [...new Set(values
        .map(value => value.productLabelKind)
        .filter((value): value is NonNullable<DocumentIrTablePriceCalendar['productLabelKind']> => Boolean(value)))];
      if (productLabelKinds.length > 1) return [];
      if (!values.every(value => value.prices.every(price => /^\d{4}-\d{2}-\d{2}$/u.test(price.date ?? '')))) return [];
      const byDate = new Map<string, V3PriceCalendarEntry>();
      for (const value of values) {
        for (const price of value.prices) {
          const key = `${price.date}|${price.weekday ?? ''}`;
          const previous = byDate.get(key);
          if (previous && (previous.amount !== price.amount || previous.currency !== price.currency)) return [];
          byDate.set(key, previous ?? price);
        }
      }
      return [{
        ...values[0]!,
        productLabelKind: productLabelKinds[0] ?? values[0]!.productLabelKind ?? null,
        tableId: values.map(value => value.tableId).join('+'),
        prices: [...byDate.values()].sort((left, right) => String(left.date).localeCompare(String(right.date))),
        sourceNodeIds: [...new Set(values.flatMap(value => value.sourceNodeIds))],
      }];
    })
    .sort((left, right) => (
      left.durationDays - right.durationDays
      || String(left.transportCode).localeCompare(String(right.transportCode), 'en')
      || String(left.gradeLabel).localeCompare(String(right.gradeLabel), 'ko')
    ));
}
