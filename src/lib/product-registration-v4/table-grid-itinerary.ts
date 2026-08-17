import type {
  V3Evidence,
  V3EventType,
  V3LedgerEvent,
  V3LedgerVariant,
} from '@/lib/product-registration-v3/types';

import type { DocumentIR, DocumentIrTable, DocumentIrTableCell } from './types';

type GridCell = DocumentIrTableCell & { originRow: number; originColumn: number };

export type DocumentIrTableItinerary = {
  tableId: string;
  days: V3LedgerVariant['days'];
  flightSegments: V3LedgerVariant['flight_segments'];
  sourceNodeIds: string[];
};

// Some supplier itinerary tables use a bare `1일`, `2일`, `3일` value in
// the dedicated date column. Keep the expression fully anchored so prose such
// as `2일차 중식` cannot become a product duration or an itinerary boundary.
const DAY_RE = /^(?:제\s*(\d{1,2})\s*일(?:차)?|DAY\s*(\d{1,2})|([1-9]\d?)\s*일차|([1-9]\d?)\s*일)$/i;
const FLIGHT_RE = /\b([A-Z][A-Z0-9]|[0-9][A-Z])\s*(\d{3,4})\b/;
const IATA_RE = /^[A-Z]{3}$/;
const TIME_RE = /\b([01]?\d|2[0-3]):[0-5]\d\b/g;

function compact(value: string): string {
  return value.replace(/\s+/g, '').trim();
}

function lines(value: string): string[] {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function dayNumber(value: string): number | null {
  const match = compact(value).match(DAY_RE);
  const number = Number(match?.[1] ?? match?.[2] ?? match?.[3] ?? match?.[4] ?? 0);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function headerColumns(table: DocumentIrTable): Map<string, number> | null {
  for (let row = 0; row < table.rows; row += 1) {
    const headers = new Map<string, number>();
    for (const cell of table.cells.filter(candidate => candidate.row === row)) {
      const value = compact(cell.text);
      if (/^(?:일자|날짜|일시|행사날짜)$/.test(value)) headers.set('day', cell.column);
      else if (/^(?:지역|도시명|행선지)$/.test(value)) headers.set('region', cell.column);
      else if (/^교통편?$/.test(value)) headers.set('transport', cell.column);
      else if (/^시간$/.test(value)) headers.set('time', cell.column);
      else if (/^(?:일정|세부일정|상세일정|세부사항|주요행사일정|행사일정)$/.test(value)) headers.set('schedule', cell.column);
      else if (/^식사$/.test(value)) headers.set('meal', cell.column);
    }
    if (['day', 'region', 'transport', 'time', 'schedule', 'meal'].every(key => headers.has(key))) {
      headers.set('headerRow', row);
      return headers;
    }
  }
  return null;
}

function buildGrid(table: DocumentIrTable): Array<Array<GridCell | null>> {
  const grid = Array.from({ length: table.rows }, () => Array<GridCell | null>(table.columns).fill(null));
  for (const cell of table.cells) {
    const value: GridCell = { ...cell, originRow: cell.row, originColumn: cell.column };
    for (let row = cell.row; row < Math.min(table.rows, cell.row + cell.rowSpan); row += 1) {
      for (let column = cell.column; column < Math.min(table.columns, cell.column + cell.colSpan); column += 1) {
        grid[row]![column] = value;
      }
    }
  }
  return grid;
}

function evidenceForCell(sectionRawText: string, table: DocumentIrTable, cell: GridCell): V3Evidence {
  const normalized = sectionRawText.replace(/\r\n?/g, '\n');
  const cellLines = lines(cell.text);
  const firstLine = cellLines[0] ?? cell.text;
  const sourceLines = normalized.split('\n');
  const priorSameFirstLineCount = table.cells
    .filter(candidate => candidate.id !== cell.id)
    .filter(candidate => candidate.row < cell.originRow || (
      candidate.row === cell.originRow && candidate.column < cell.originColumn
    ))
    .filter(candidate => lines(candidate.text).some(line => line.trim() === firstLine.trim()))
    .length;
  const matchingFirstLines = sourceLines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(candidate => candidate.line === firstLine.trim());
  const lineIndex = matchingFirstLines[priorSameFirstLineCount]?.index
    ?? matchingFirstLines[0]?.index
    ?? -1;
  const matchedLineIndexes = lineIndex >= 0 ? [lineIndex] : [];
  let cursor = lineIndex + 1;
  for (const expected of cellLines.slice(1)) {
    const next = sourceLines.findIndex((line, index) => index >= cursor && line.trim() === expected.trim());
    if (next < 0) continue;
    matchedLineIndexes.push(next);
    cursor = next + 1;
  }
  const firstMatchedIndex = matchedLineIndexes[0] ?? 0;
  const lastMatchedIndex = matchedLineIndexes.at(-1) ?? firstMatchedIndex;
  const charStart = sourceLines.slice(0, firstMatchedIndex).reduce((sum, line) => sum + line.length + 1, 0);
  const charEnd = sourceLines.slice(0, lastMatchedIndex + 1).reduce((sum, line) => sum + line.length + 1, 0) - 1;
  return {
    line_start: firstMatchedIndex + 1,
    line_end: lastMatchedIndex + 1,
    char_start: charStart,
    char_end: Math.max(charStart, charEnd),
    quote: cell.text,
    node_id: cell.nodeId,
    page: cell.evidence.page ?? table.page,
    table_id: table.id,
    row: cell.originRow,
    column: cell.originColumn,
    quote_hash: cell.evidence.quoteHash,
    extraction_method: 'document_ir_table_cell',
  };
}

function eventType(text: string): V3EventType {
  if (/공항.*(?:출발|도착)|(?:출발|도착).*공항|\b[A-Z0-9]{2}\d{3,4}\b/.test(text)) return 'flight';
  if (/미팅|집결/.test(text)) return 'meeting';
  if (/송영|이동|차량|버스/.test(text)) return 'transfer';
  if (/호텔|리조트|체크인|숙박/.test(text)) return 'hotel';
  if (/자유\s*(?:일정|시간)|휴식/.test(text)) return 'free_time';
  if (/골프|라운딩|\bC\.?C\.?\b|\bG\.?C\.?\b/i.test(text)) return 'activity';
  if (/일정.*변경|현지.*사정|항공.*사정/.test(text)) return 'notice';
  return 'activity';
}

function event(text: string, evidence: V3Evidence): V3LedgerEvent {
  return {
    type: eventType(text),
    time: text.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/)?.[0] ?? null,
    raw_text: text,
    canonical_id: null,
    canonical_type: null,
    match_status: 'ignored',
    evidence,
  };
}

function emptyMeals(): V3LedgerVariant['days'][number]['meals'] {
  return { breakfast: {}, lunch: {}, dinner: {} };
}

function mealKey(value: string): keyof ReturnType<typeof emptyMeals> | null {
  const prefix = compact(value).slice(0, 1);
  if (prefix === '조') return 'breakfast';
  if (prefix === '중') return 'lunch';
  if (prefix === '석') return 'dinner';
  return null;
}

function sectionContainsTable(sectionRawText: string, table: DocumentIrTable): boolean {
  const productTitles = table.cells
    .filter(cell => cell.row <= 1)
    .flatMap(cell => lines(cell.text))
    .filter(value => value.length >= 6 && (
      /(?:\bPKG\b|PACKAGE|\uD328\uD0A4\uC9C0)/iu.test(value)
      || /(?:^|[\[【(])(?:\uC2E4\uC18D|\uD488\uACA9|\uACE0\uD488\uACA9|\uB77C\uC774\uD2B8|\uD504\uB9AC\uBBF8\uC5C4)[\]】)]?[^\n]{0,100}\d{1,2}\s*\uBC15\s*\d{1,2}\s*\uC77C/iu.test(value)
    ));
  if (productTitles.length > 0 && !productTitles.some(title => sectionRawText.includes(title))) return false;
  const anchors = table.cells
    .flatMap(cell => lines(cell.text))
    .filter(value => DAY_RE.test(compact(value)) || FLIGHT_RE.test(value));
  return anchors.length > 0 && anchors.every(anchor => sectionRawText.includes(anchor));
}

function declaredDurationDays(sectionRawText: string): Set<number> {
  const heading = sectionRawText.slice(0, 1_200);
  const durations = new Set<number>();
  for (const match of heading.matchAll(/(\d{1,2})\s*\uBC15\s*(\d{1,2})\s*\uC77C/gu)) {
    const days = Number(match[2]);
    if (days >= 2 && days <= 31) durations.add(days);
  }
  for (const match of heading.matchAll(/(?:^|[^\d])(\d{1,2})\s*\uC77C\s*[,/&]\s*(\d{1,2})\s*\uC77C(?:[^\d]|$)/gu)) {
    for (const value of [match[1], match[2]]) {
      const days = Number(value);
      if (days >= 2 && days <= 31) durations.add(days);
    }
  }
  return durations;
}

function parseTableItinerary(input: {
  sectionRawText: string;
  table: DocumentIrTable;
  headers: Map<string, number>;
}): DocumentIrTableItinerary | null {
  const { table, headers } = input;
  const grid = buildGrid(table);
  const days = new Map<number, V3LedgerVariant['days'][number]>();
  const flights: V3LedgerVariant['flight_segments'] = [];
  let previousHotel: Record<string, unknown> | null = null;
  let currentDay: number | null = null;

  for (let row = (headers.get('headerRow') ?? 0) + 1; row < table.rows; row += 1) {
    const dayCell = grid[row]![headers.get('day')!];
    const parsedDay = dayCell ? dayNumber(dayCell.text) : null;
    if (parsedDay) currentDay = parsedDay;
    const day = parsedDay ?? currentDay;
    if (!day) continue;
    const current = days.get(day) ?? { day, route: [], events: [], meals: emptyMeals(), hotel: {} };

    const regionCell = grid[row]![headers.get('region')!];
    if (parsedDay && regionCell?.originRow === row) {
      current.route = [...new Set([...current.route, ...lines(regionCell.text)])];
    }

    const scheduleCell = grid[row]![headers.get('schedule')!];
    if (scheduleCell?.originRow === row) {
      const scheduleEvidence = evidenceForCell(input.sectionRawText, table, scheduleCell);
      for (const scheduleLine of lines(scheduleCell.text)) {
        const hotelMatch = scheduleLine.match(/^(?:HOTEL|H)\s*:\s*(.+)$/i)
          ?? scheduleLine.match(/^:\s*(.+(?:동급|호텔|리조트|\d\s*성).*)$/u);
        if (hotelMatch) {
          const isSame = /^(?:상동|전일과\s*동일)$/.test(hotelMatch[1]!.trim());
          const hotel: Record<string, unknown> = isSame && previousHotel
            ? { ...previousHotel, source_text: scheduleLine, same_as_previous: true, evidence: scheduleEvidence }
            : { raw_text: hotelMatch[1]!.trim(), source_text: scheduleLine, evidence: scheduleEvidence };
          current.hotel = hotel;
          previousHotel = hotel;
          continue;
        }
        current.events.push(event(scheduleLine, scheduleEvidence));
      }
    }

    const mealCell = grid[row]![headers.get('meal')!];
    if (parsedDay && mealCell?.originRow === row) {
      const mealEvidence = evidenceForCell(input.sectionRawText, table, mealCell);
      for (const mealLine of lines(mealCell.text)) {
        const key = mealKey(mealLine);
        if (key) current.meals[key] = { raw_text: mealLine, evidence: mealEvidence };
      }
    }

    const transportCell = grid[row]![headers.get('transport')!];
    if (parsedDay && transportCell?.originRow === row) {
      const codeMatch = transportCell.text.match(FLIGHT_RE);
      if (codeMatch) {
        const routeCodes = lines(regionCell?.text ?? '').map(value => compact(value).toUpperCase()).filter(value => IATA_RE.test(value));
        const times = lines(grid[row]![headers.get('time')!]?.text ?? '').flatMap(value => value.match(TIME_RE) ?? []);
        const transportEvidence = evidenceForCell(input.sectionRawText, table, transportCell);
        flights.push({
          leg: flights.length === 0 ? 'outbound' : flights.length === 1 ? 'inbound' : 'unknown',
          code: `${codeMatch[1]}${codeMatch[2]}`,
          dep_airport: routeCodes[0] ?? null,
          arr_airport: routeCodes[1] ?? null,
          dep_time: times[0] ?? null,
          arr_time: times[1] ?? null,
          evidence: {
            ...transportEvidence,
            quote: [regionCell?.text, transportCell.text, grid[row]![headers.get('time')!]?.text].filter(Boolean).join('\n'),
          },
        });
      }
    }

    days.set(day, current);
  }

  const orderedDays = [...days.values()].sort((left, right) => left.day - right.day);
  if (orderedDays.length === 0) return null;
  if (orderedDays.some((item, index) => item.day !== index + 1)) return null;
  return {
    tableId: table.id,
    days: orderedDays,
    flightSegments: flights,
    sourceNodeIds: table.cells.map(cell => cell.nodeId),
  };
}

/**
 * Reconstructs supplier itinerary rows from EvidenceIR instead of the flat
 * text order. Merged DAY/route/time cells are expanded only for row ownership;
 * their facts are emitted once from the originating cell.
 *
 * Multiple itinerary tables may represent duration variants of one product.
 * A duration is returned only when exactly one source table owns it; duplicate
 * tables of the same duration remain ambiguous and are therefore excluded.
 */
export function buildDocumentIrTableItineraries(input: {
  documentIr: DocumentIR;
  sectionRawText: string;
}): DocumentIrTableItinerary[] {
  const localSection = input.sectionRawText.split(/\n\s*---\s*\n/u).at(-1) ?? input.sectionRawText;
  const durations = declaredDurationDays(localSection);
  const parsed = input.documentIr.tables
    .map(table => ({ table, headers: headerColumns(table) }))
    .filter((candidate): candidate is { table: DocumentIrTable; headers: Map<string, number> } => (
      Boolean(candidate.headers) && sectionContainsTable(localSection, candidate.table)
    ))
    .flatMap(candidate => {
      const itinerary = parseTableItinerary({
        sectionRawText: input.sectionRawText,
        table: candidate.table,
        headers: candidate.headers,
      });
      return itinerary ? [itinerary] : [];
    })
    .filter(itinerary => durations.size === 0 || durations.has(itinerary.days.length));
  const countsByDuration = parsed.reduce<Map<number, number>>((counts, itinerary) => (
    counts.set(itinerary.days.length, (counts.get(itinerary.days.length) ?? 0) + 1)
  ), new Map());
  return parsed
    .filter(itinerary => countsByDuration.get(itinerary.days.length) === 1)
    .sort((left, right) => left.days.length - right.days.length || left.tableId.localeCompare(right.tableId));
}

export function buildDocumentIrTableItinerary(input: {
  documentIr: DocumentIR;
  sectionRawText: string;
}): DocumentIrTableItinerary | null {
  const candidates = buildDocumentIrTableItineraries(input);
  return candidates.length === 1 ? candidates[0]! : null;
}
