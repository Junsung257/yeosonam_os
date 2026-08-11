import { createHash } from 'node:crypto';

import type {
  DocumentIR,
  DocumentIrNode,
  DocumentIrTable,
  ProductSourceType,
} from './types';

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function nodeId(prefix: string, index: number, text = ''): string {
  return `${prefix}-${index}-${sha256Hex(text).slice(0, 12)}`;
}

export function createTextDocumentIR(input: {
  filename: string;
  sourceType: ProductSourceType;
  text: string;
  parserEngine: string;
  parserVersion: string;
  parserChecksum?: string;
}): DocumentIR {
  const normalized = input.text.replace(/\r\n?/g, '\n').trim();
  const nodes: DocumentIrNode[] = [];
  const lines = normalized.split('\n');

  lines.forEach((line, index) => {
    const text = line.trim();
    if (!text) {
      nodes.push({
        id: nodeId('break', index, line),
        kind: 'line_break',
        order: index,
      });
      return;
    }
    nodes.push({
      id: nodeId('paragraph', index, text),
      kind: 'paragraph',
      text,
      order: index,
      attributes: { sourceLine: index + 1 },
    });
  });

  return {
    version: 'v4',
    filename: input.filename,
    sourceType: input.sourceType,
    pages: 1,
    text: normalized,
    nodes,
    tables: [],
    assets: [],
    parser: {
      engine: input.parserEngine,
      version: input.parserVersion,
      checksum: input.parserChecksum,
    },
  };
}

export function createOcrDocumentIR(input: {
  filename: string;
  sourceType: ProductSourceType;
  text: string;
  parserEngine: string;
  parserVersion: string;
  pages: Array<{
    page: number;
    text: string;
    nodes?: Array<{ text: string; confidence?: number | null; boundingBox?: unknown }>;
    tables?: Array<{ cells: Array<{ row: number; column: number; rowSpan: number; colSpan: number; text: string; confidence?: number | null; boundingBox?: unknown }> }>;
  }>;
  providerResults: Array<Record<string, unknown>>;
  totalCostKrw: number;
}): DocumentIR {
  const nodes: DocumentIrNode[] = [];
  const tables: DocumentIrTable[] = [];
  let order = 0;
  for (const page of input.pages) {
    const pageId = nodeId('page', page.page, page.text);
    nodes.push({ id: pageId, kind: 'page', page: page.page, order: order++, attributes: { source: 'ocr' } });
    for (const [index, item] of (page.nodes ?? []).entries()) {
      const id = nodeId(`ocr-p${page.page}`, index, item.text);
      nodes.push({
        id,
        kind: 'paragraph',
        text: item.text,
        page: page.page,
        parentId: pageId,
        order: order++,
        attributes: { confidence: item.confidence ?? null, boundingBox: item.boundingBox ?? null },
      });
    }
    for (const [tableIndex, sourceTable] of (page.tables ?? []).entries()) {
      const tableId = `ocr-table-p${page.page}-${tableIndex}`;
      const cells = sourceTable.cells.map((cell, cellIndex) => {
        const id = nodeId(`${tableId}-cell`, cellIndex, cell.text);
        nodes.push({
          id,
          kind: 'cell',
          text: cell.text,
          page: page.page,
          parentId: tableId,
          order: order++,
          attributes: { row: cell.row, column: cell.column, confidence: cell.confidence ?? null, boundingBox: cell.boundingBox ?? null },
        });
        return {
          id: `${tableId}-${cell.row}-${cell.column}`,
          row: cell.row,
          column: cell.column,
          rowSpan: cell.rowSpan,
          colSpan: cell.colSpan,
          text: cell.text,
          nodeId: id,
          evidence: { page: page.page, quoteHash: sha256Hex(cell.text) },
        };
      });
      tables.push({
        id: tableId,
        page: page.page,
        rows: Math.max(0, ...cells.map(cell => cell.row + cell.rowSpan)),
        columns: Math.max(0, ...cells.map(cell => cell.column + cell.colSpan)),
        cells,
      });
      nodes.push({ id: tableId, kind: 'table', page: page.page, parentId: pageId, order: order++, attributes: { tableIndex } });
    }
  }
  return {
    version: 'v4',
    filename: input.filename,
    sourceType: input.sourceType,
    pages: Math.max(1, input.pages.length),
    text: input.text.replace(/\r\n?/g, '\n').trim(),
    nodes,
    tables,
    assets: [{
      id: 'ocr-provider-run',
      kind: input.sourceType === 'pdf' ? 'pdf' : 'image',
      metadata: { providerResults: input.providerResults, totalCostKrw: input.totalCostKrw },
    }],
    parser: { engine: input.parserEngine, version: input.parserVersion },
  };
}

export function getDocumentIRValidationErrors(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return ['DOCUMENT_IR_NOT_OBJECT'];
  const ir = value as Partial<DocumentIR>;
  if (ir.version !== 'v4') errors.push('DOCUMENT_IR_VERSION_INVALID');
  if (typeof ir.filename !== 'string' || !ir.filename.trim()) errors.push('DOCUMENT_IR_FILENAME_INVALID');
  if (!['text', 'pdf', 'image', 'hwp', 'hwpx'].includes(String(ir.sourceType))) errors.push('DOCUMENT_IR_SOURCE_TYPE_INVALID');
  if (!Number.isInteger(ir.pages) || Number(ir.pages) < 1) errors.push('DOCUMENT_IR_PAGES_INVALID');
  if (typeof ir.text !== 'string') errors.push('DOCUMENT_IR_TEXT_INVALID');
  if (!Array.isArray(ir.nodes)) errors.push('DOCUMENT_IR_NODES_INVALID');
  if (!Array.isArray(ir.tables)) errors.push('DOCUMENT_IR_TABLES_INVALID');
  if (!Array.isArray(ir.assets)) errors.push('DOCUMENT_IR_ASSETS_INVALID');
  if (!ir.parser || typeof ir.parser !== 'object') {
    errors.push('DOCUMENT_IR_PARSER_INVALID');
  } else {
    if (typeof ir.parser.engine !== 'string' || !ir.parser.engine.trim()) errors.push('DOCUMENT_IR_PARSER_ENGINE_INVALID');
    if (typeof ir.parser.version !== 'string' || !ir.parser.version.trim()) errors.push('DOCUMENT_IR_PARSER_VERSION_INVALID');
  }
  return errors;
}

export function validateDocumentIR(value: unknown): value is DocumentIR {
  return getDocumentIRValidationErrors(value).length === 0;
}

export function flattenTableText(table: DocumentIrTable): string {
  const byRow = new Map<number, Array<{ column: number; text: string }>>();
  for (const cell of table.cells) {
    const row = byRow.get(cell.row) ?? [];
    row.push({ column: cell.column, text: cell.text });
    byRow.set(cell.row, row);
  }
  return [...byRow.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, cells]) => cells.sort((left, right) => left.column - right.column).map(cell => cell.text).join('\t'))
    .join('\n');
}
