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
