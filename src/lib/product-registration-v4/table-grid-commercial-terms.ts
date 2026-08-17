import type { V3Evidence, V3LedgerVariant } from '@/lib/product-registration-v3/types';

import type { DocumentIR, DocumentIrTable, DocumentIrTableCell } from './types';

type CommercialItem = V3LedgerVariant['inclusions'][number];

export type DocumentIrTableCommercialTerms = {
  tableId: string;
  inclusions: CommercialItem[];
  exclusions: CommercialItem[];
  sourceNodeIds: string[];
};

export type DocumentIrTableCommercialTermsByDuration = DocumentIrTableCommercialTerms & {
  durationDays: number;
  departureWeekdays: number[];
};

function compact(value: string): string {
  return value.replace(/\s+/g, '').trim();
}

function headerKind(value: string): 'inclusion' | 'exclusion' | null {
  const normalized = compact(value).replace(/[:：]$/, '');
  if (/^(?:포함|포함내역|포함사항|포함조건)$/u.test(normalized)) return 'inclusion';
  if (/^(?:불포함|불포함내역|불포함사항|제외사항)$/u.test(normalized)) return 'exclusion';
  return null;
}

function splitItems(value: string): string[] {
  return value
    .split(/\r?\n|[,，](?!\d{3}(?:[,，]|\D|$))/u)
    .map(item => item.replace(/^[-•·▪▶※]\s*/u, '').trim())
    .filter(Boolean)
    .filter(item => !headerKind(item));
}

function evidenceForCell(sectionRawText: string, table: DocumentIrTable, cell: DocumentIrTableCell): V3Evidence {
  const sourceLines = sectionRawText.replace(/\r\n?/g, '\n').split('\n');
  const cellLines = cell.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const firstLine = cellLines[0] ?? cell.text.trim();
  const lineIndex = sourceLines.findIndex(line => line.trim() === firstLine);
  const safeLineIndex = Math.max(0, lineIndex);
  const charStart = sourceLines.slice(0, safeLineIndex).reduce((sum, line) => sum + line.length + 1, 0);
  return {
    line_start: safeLineIndex + 1,
    line_end: safeLineIndex + Math.max(1, cellLines.length),
    char_start: charStart,
    char_end: charStart + cell.text.length,
    quote: cell.text,
    node_id: cell.nodeId,
    page: cell.evidence.page ?? table.page,
    table_id: table.id,
    row: cell.row,
    column: cell.column,
    quote_hash: cell.evidence.quoteHash,
    extraction_method: 'document_ir_table_cell',
  };
}

function parseTable(table: DocumentIrTable, sectionRawText: string): DocumentIrTableCommercialTerms | null {
  const result: DocumentIrTableCommercialTerms = {
    tableId: table.id,
    inclusions: [],
    exclusions: [],
    sourceNodeIds: [],
  };
  for (const header of table.cells) {
    const kind = headerKind(header.text);
    if (!kind) continue;
    const values = table.cells
      .filter(cell => cell.row === header.row && cell.column >= header.column + header.colSpan)
      .sort((left, right) => left.column - right.column);
    for (const cell of values) {
      const evidence = evidenceForCell(sectionRawText, table, cell);
      for (const value of splitItems(cell.text)) {
        const item = { value, evidence };
        if (kind === 'inclusion') result.inclusions.push(item);
        else result.exclusions.push(item);
      }
      result.sourceNodeIds.push(cell.nodeId);
    }
    result.sourceNodeIds.push(header.nodeId);
  }
  if (result.inclusions.length === 0 || result.exclusions.length === 0) return null;
  const anchors = [...result.inclusions, ...result.exclusions]
    .map(item => item.value)
    .filter(value => value.length >= 2);
  if (anchors.length === 0 || !anchors.every(anchor => sectionRawText.includes(anchor))) return null;
  result.sourceNodeIds = [...new Set(result.sourceNodeIds)];
  return result;
}

export function documentIrTableDurationDays(table: DocumentIrTable): number | null {
  // A product-title duration is the commercial axis. It remains authoritative
  // even when an itinerary has a duplicated or missing DAY label; itinerary
  // continuity is validated separately and must not attach the right terms to
  // the wrong sibling product. Reject date/range language so that
  // "26년 4월 3일" can never become a three-day product.
  const titleDurations = table.cells.flatMap(cell => cell.text.split(/\r?\n/u))
    .map(line => line.normalize('NFKC').replace(/\s+/g, ' ').trim())
    .filter(line => line.length >= 8 && line.length <= 180)
    .filter(line => !/(?:\d{2,4}\s*\uB144|\d{1,2}\s*\uC6D4|\uCD9C\s*\uBC1C\s*\uC77C|\uC801\s*\uC6A9\s*\uAE30\s*\uAC04|[~\u301C]\s*\d)/u.test(line))
    .filter(line => (line.match(/[\p{Script=Hangul}A-Za-z]/gu) ?? []).length >= 4)
    .flatMap(line => {
      const match = line.match(/(?:^|\s)(\d{1,2})\s*\uC77C(?:\s*(?:[-\u2013\u2014]|\b(?:PKG|PACKAGE)\b)|\s*$)/iu);
      const duration = Number(match?.[1]);
      return Number.isInteger(duration) && duration >= 2 && duration <= 31 ? [duration] : [];
    });
  const distinct = [...new Set(titleDurations)];
  if (distinct.length === 1) return distinct[0]!;

  const days = table.cells.flatMap(cell => [...cell.text.matchAll(/(?:\uC81C\s*(\d{1,2})\s*\uC77C(?:\uCC28)?|(\d{1,2})\s*\uC77C\uCC28|DAY\s*(\d{1,2}))/giu)])
    .map(match => Number(match[1] ?? match[2] ?? match[3]))
    .filter(day => Number.isInteger(day) && day >= 1 && day <= 31);
  return days.length > 0 ? Math.max(...days) : null;
}

function tableDepartureWeekdays(table: DocumentIrTable): number[] {
  const weekdayNumber: Record<string, number> = {
    '\uC77C': 0,
    '\uC6D4': 1,
    '\uD654': 2,
    '\uC218': 3,
    '\uBAA9': 4,
    '\uAE08': 5,
    '\uD1A0': 6,
  };
  return [...new Set(table.cells.flatMap(cell => [...cell.text.matchAll(/([\uC77C\uC6D4\uD654\uC218\uBAA9\uAE08\uD1A0])(?:\uC694\uC77C)?\s*\uCD9C\uBC1C/gu)])
    .map(match => weekdayNumber[match[1]!])
    .filter((value): value is number => value != null))].sort((left, right) => left - right);
}

function normalizedNodeText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function isProductBoundaryText(text: string): boolean {
  const hasFullDuration = /\d+\s*\uBC15\s*\d+\s*\uC77C/u.test(text);
  const hasCompositeNightPkg = /<[^>\n]*\d+\s*\uBC15[^>\n]*>[^\n]{0,100}\bPKG\b/iu.test(text);
  if (!hasFullDuration && !hasCompositeNightPkg) return false;
  if (/(?:\uCD9C\uBC1C\s*\uAE30\uC900|\uC801\uC6A9\s*\uAE30\uAC04|\uC5EC\uD589\s*\uAE30\uAC04)/u.test(text)) return false;
  return (text.match(/[\p{Script=Hangul}A-Za-z]/gu) ?? []).length >= 2;
}

function tableSectionAffinityScore(table: DocumentIrTable, localSection: string): number {
  const anchors = [...new Set(table.cells
    .flatMap(cell => cell.text.split(/\r?\n/u))
    .map(normalizedNodeText)
    .filter(text => text.length >= 4)
    .filter(text => !headerKind(text))
    .filter(text => !/^(?:\uCD9C\uBC1C\uC77C|\uC0C1\uD488\uAC00|\uC77C\uC790|\uC9C0\uC5ED|\uAD50\uD1B5\uD3B8?|\uC2DC\uAC04|\uC77C\uC815|\uC2DD\uC0AC)$/u.test(compact(text))))];
  return anchors.reduce((score, anchor) => (
    localSection.includes(anchor) ? score + Math.min(80, anchor.length) : score
  ), 0);
}

function canonicalTerms(candidate: DocumentIrTableCommercialTerms): string {
  const values = (items: CommercialItem[]) => items
    .map(item => normalizedNodeText(item.value))
    .sort((left, right) => left.localeCompare(right, 'ko'));
  return JSON.stringify({ inclusions: values(candidate.inclusions), exclusions: values(candidate.exclusions) });
}

function selectCandidateInsideSection(input: {
  documentIr: DocumentIR;
  sectionRawText: string;
  candidates: DocumentIrTableCommercialTerms[];
}): DocumentIrTableCommercialTerms | null {
  if (input.candidates.length === 1) return input.candidates[0]!;
  if (input.candidates.length === 0) return null;

  const localSection = input.sectionRawText.split(/\n\s*---\s*\n/u).at(-1) ?? input.sectionRawText;
  const localLines = localSection
    .split(/\r?\n/u)
    .map(normalizedNodeText)
    .filter(line => line.length >= 4);
  const nodeOrdersByText = new Map<string, number[]>();
  for (const node of input.documentIr.nodes) {
    const text = normalizedNodeText(node.text ?? '');
    if (!text) continue;
    const orders = nodeOrdersByText.get(text) ?? [];
    orders.push(node.order);
    nodeOrdersByText.set(text, orders);
  }

  const localLineSet = new Set(localLines);
  const affinityByTable = input.candidates
    .map(candidate => ({
      candidate,
      score: tableSectionAffinityScore(
        input.documentIr.tables.find(table => table.id === candidate.tableId)!,
        localSection,
      ),
    }))
    .sort((left, right) => right.score - left.score || left.candidate.tableId.localeCompare(right.candidate.tableId));
  const bestAffinity = affinityByTable[0];
  const nextAffinity = affinityByTable[1];
  if (bestAffinity && bestAffinity.score >= 10 && bestAffinity.score - (nextAffinity?.score ?? 0) >= 8) {
    return bestAffinity.candidate;
  }
  const nodeOrders = new Map(input.documentIr.nodes.map(node => [node.id, node.order] as const));
  const boundaryNodes = input.documentIr.nodes
    .map(node => ({ order: node.order, text: normalizedNodeText(node.text ?? '') }))
    .filter(node => isProductBoundaryText(node.text))
    .sort((left, right) => left.order - right.order);
  const affinityMatches = input.candidates.filter(candidate => {
    const sourceOrders = candidate.sourceNodeIds
      .map(nodeId => nodeOrders.get(nodeId))
      .filter((order): order is number => order != null);
    if (sourceOrders.length === 0) return false;
    const candidateStart = Math.min(...sourceOrders);
    const precedingBoundary = boundaryNodes.filter(node => node.order <= candidateStart).at(-1);
    return Boolean(precedingBoundary && localLineSet.has(precedingBoundary.text));
  });
  if (affinityMatches.length === 1) return affinityMatches[0]!;

  const distinctTerms = new Set(input.candidates.map(canonicalTerms));
  if (distinctTerms.size === 1) return input.candidates[0]!;

  const sectionStart = localLines
    .map(line => nodeOrdersByText.get(line) ?? [])
    .find(orders => orders.length === 1)?.[0];
  if (sectionStart == null) return null;
  const nextSectionStart = input.documentIr.nodes
    .filter(node => node.order > sectionStart)
    .filter(node => {
      const text = normalizedNodeText(node.text ?? '');
      if (!text || localLineSet.has(text)) return false;
      return isProductBoundaryText(text);
    })
    .sort((left, right) => left.order - right.order)[0]?.order ?? Number.POSITIVE_INFINITY;
  const inside = input.candidates.filter(candidate => {
    const sourceOrders = candidate.sourceNodeIds
      .map(nodeId => nodeOrders.get(nodeId))
      .filter((order): order is number => order != null);
    const tableOrder = nodeOrders.get(candidate.tableId);
    const orders = sourceOrders.length > 0 ? sourceOrders : tableOrder == null ? [] : [tableOrder];
    return orders.some(order => order >= sectionStart && order < nextSectionStart);
  });
  if (inside.length === 1) return inside[0]!;

  return null;
}

/**
 * Reads commercial terms from their actual EvidenceIR table rows. Flat text
 * ordering is unreliable for HWP cells and can put values before headings.
 */
export function buildDocumentIrTableCommercialTerms(input: {
  documentIr: DocumentIR;
  sectionRawText: string;
}): DocumentIrTableCommercialTerms | null {
  const candidates = buildDocumentIrTableCommercialTermCandidates(input);
  return selectCandidateInsideSection({ ...input, candidates });
}

/**
 * Returns every source-backed commercial table that is actually present in
 * the local section. The canonical worker uses this only when an explicit
 * price matrix has already proved multiple product axes (for example
 * 실속/노옵션/품격). Keeping the candidates separate prevents one product's
 * shopping, option, or guide policy from being copied to every sibling.
 */
export function buildDocumentIrTableCommercialTermCandidates(input: {
  documentIr: DocumentIR;
  sectionRawText: string;
}): DocumentIrTableCommercialTerms[] {
  return input.documentIr.tables
    .map(table => parseTable(table, input.sectionRawText))
    .filter((value): value is DocumentIrTableCommercialTerms => Boolean(value));
}

export function buildDocumentIrTableCommercialTermsByDuration(input: {
  documentIr: DocumentIR;
  sectionRawText: string;
}): DocumentIrTableCommercialTermsByDuration[] {
  const candidates = input.documentIr.tables.flatMap(table => {
    const terms = parseTable(table, input.sectionRawText);
    const durationDays = documentIrTableDurationDays(table);
    return terms && durationDays ? [{ ...terms, durationDays, departureWeekdays: tableDepartureWeekdays(table) }] : [];
  });
  const counts = candidates.reduce<Map<number, number>>((map, candidate) => (
    map.set(candidate.durationDays, (map.get(candidate.durationDays) ?? 0) + 1)
  ), new Map());
  return candidates
    .filter(candidate => counts.get(candidate.durationDays) === 1)
    .sort((left, right) => left.durationDays - right.durationDays);
}
