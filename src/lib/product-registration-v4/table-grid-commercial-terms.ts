import type { V3Evidence, V3LedgerVariant } from '@/lib/product-registration-v3/types';

import type { DocumentIR, DocumentIrTable, DocumentIrTableCell } from './types';

type CommercialItem = V3LedgerVariant['inclusions'][number];

export type DocumentIrTableCommercialTerms = {
  tableId: string;
  inclusions: CommercialItem[];
  exclusions: CommercialItem[];
  sourceNodeIds: string[];
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
    .split(/\r?\n|[,，]/u)
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

/**
 * Reads commercial terms from their actual EvidenceIR table rows. Flat text
 * ordering is unreliable for HWP cells and can put values before headings.
 */
export function buildDocumentIrTableCommercialTerms(input: {
  documentIr: DocumentIR;
  sectionRawText: string;
}): DocumentIrTableCommercialTerms | null {
  const candidates = input.documentIr.tables
    .map(table => parseTable(table, input.sectionRawText))
    .filter((value): value is DocumentIrTableCommercialTerms => Boolean(value));
  return candidates.length === 1 ? candidates[0]! : null;
}
