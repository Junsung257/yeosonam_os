import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { createTextDocumentIR, sha256Hex } from './document-ir';
import type { DocumentIR, DocumentIrNode, DocumentIrTable, ProductSourceType } from './types';
import { PRODUCT_REGISTRATION_V4_PARSER_VERSION } from './types';

const execFileAsync = promisify(execFile);
const RHWP_MAX_BUFFER = 32 * 1024 * 1024;

type RhwpTextPayload = {
  pageCount?: number;
  pages?: Array<{ page?: number; text?: string }>;
};

type RhwpTablePayload = {
  tables?: Array<{
    index?: number;
    page?: number;
    rows?: number;
    cols?: number;
    cells?: Array<{
      row?: number;
      col?: number;
      rowSpan?: number;
      colSpan?: number;
      text?: string;
    }>;
  }>;
};

function resolveRhwpBinary(): string {
  const configured = process.env.RHWP_BIN?.trim() || process.env.RHWP_PATH?.trim();
  if (configured) return configured;
  const bundled = join(
    process.cwd(),
    'vendor',
    'rhwp',
    PRODUCT_REGISTRATION_V4_PARSER_VERSION,
    process.platform === 'win32' ? 'rhwp.exe' : 'rhwp',
  );
  if (existsSync(bundled)) return bundled;
  return process.platform === 'win32' ? 'rhwp.exe' : 'rhwp';
}

function parseJsonPayload<T>(stdout: string, label: string): T {
  const trimmed = stdout.replace(/^\uFEFF/, '').trim();
  if (!trimmed) throw new Error(`RHWP_${label.toUpperCase()}_EMPTY`);
  try {
    return JSON.parse(trimmed) as T;
  } catch (error) {
    throw new Error(`RHWP_${label.toUpperCase()}_INVALID_JSON:${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runRhwpJson(binary: string, args: string[], label: string): Promise<unknown> {
  try {
    const result = await execFileAsync(binary, args, {
      encoding: 'utf8',
      maxBuffer: RHWP_MAX_BUFFER,
      windowsHide: true,
    });
    return parseJsonPayload(result.stdout, label);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT|not found|cannot find/i.test(message)) {
      throw new Error('HWP_PARSER_UNAVAILABLE: configure RHWP_BIN with the pinned rhwp v0.8.2 binary');
    }
    throw new Error(`RHWP_${label.toUpperCase()}_FAILED:${message}`);
  }
}

function addRhwpTableNodes(input: {
  nodes: DocumentIrNode[];
  tables: DocumentIrTable[];
  tablePayload: RhwpTablePayload;
}): void {
  for (const [tableIndex, table] of (input.tablePayload.tables ?? []).entries()) {
    const tableId = `table-${table.index ?? tableIndex}`;
    input.nodes.push({
      id: tableId,
      kind: 'table',
      order: input.nodes.length,
      page: typeof table.page === 'number' ? table.page : undefined,
      attributes: { rows: table.rows ?? 0, columns: table.cols ?? 0 },
    });
    input.tables.push({
      id: tableId,
      page: typeof table.page === 'number' ? table.page : undefined,
      rows: table.rows ?? 0,
      columns: table.cols ?? 0,
      cells: (table.cells ?? []).map((cell, cellIndex) => {
        const row = cell.row ?? 0;
        const column = cell.col ?? 0;
        const text = (cell.text ?? '').replace(/\r\n?/g, '\n').trim();
        const cellId = `${tableId}-cell-${row}-${column}-${cellIndex}`;
        input.nodes.push({
          id: cellId,
          kind: 'cell',
          text,
          order: input.nodes.length,
          parentId: tableId,
          page: table.page,
          attributes: { row, column, rowSpan: cell.rowSpan ?? 1, colSpan: cell.colSpan ?? 1 },
        });
        return {
          id: cellId,
          row,
          column,
          rowSpan: cell.rowSpan ?? 1,
          colSpan: cell.colSpan ?? 1,
          text,
          nodeId: cellId,
          evidence: { page: table.page, quoteHash: sha256Hex(text) },
        };
      }),
    });
  }
}

export async function parseHwpWithRhwp(input: {
  buffer: Buffer;
  filename: string;
  sourceType?: Extract<ProductSourceType, 'hwp' | 'hwpx'>;
}): Promise<{ text: string; ir: DocumentIR; parserBinary: string }> {
  const binary = resolveRhwpBinary();
  const workspace = await mkdtemp(join(tmpdir(), 'yeosonam-rhwp-'));
  const inputPath = join(workspace, input.filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'document.hwp');
  try {
    await writeFile(inputPath, input.buffer, { flag: 'wx' });
    const [textPayload, tablePayload] = await Promise.all([
      runRhwpJson(binary, ['export-text', '--json', inputPath], 'text') as Promise<RhwpTextPayload>,
      runRhwpJson(binary, ['export-tables', '--json', inputPath], 'tables') as Promise<RhwpTablePayload>,
    ]);
    const pages = (textPayload.pages ?? []).map(page => page.text ?? '').filter(Boolean);
    const text = pages.join('\n').replace(/\r\n?/g, '\n').trim();
    if (text.length < 10) throw new Error('HWP_TEXT_TOO_SHORT');

    const base = createTextDocumentIR({
      filename: input.filename,
      sourceType: input.sourceType ?? (input.filename.toLowerCase().endsWith('.hwpx') ? 'hwpx' : 'hwp'),
      text,
      parserEngine: 'rhwp',
      parserVersion: '0.8.2',
    });
    base.pages = textPayload.pageCount ?? pages.length;
    base.nodes = [];
    pages.forEach((pageText, pageIndex) => {
      const pageNodeId = `page-${pageIndex}`;
      base.nodes.push({ id: pageNodeId, kind: 'page', page: pageIndex, order: base.nodes.length });
      for (const [lineIndex, line] of pageText.split('\n').entries()) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        base.nodes.push({
          id: `paragraph-${pageIndex}-${lineIndex}-${sha256Hex(trimmed).slice(0, 12)}`,
          kind: 'paragraph',
          text: trimmed,
          page: pageIndex,
          parentId: pageNodeId,
          order: base.nodes.length,
          attributes: { sourceLine: lineIndex + 1 },
        });
      }
    });
    addRhwpTableNodes({ nodes: base.nodes, tables: base.tables, tablePayload });
    return { text, ir: base, parserBinary: binary };
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function parseHwpFileWithRhwp(input: { path: string; filename: string; sourceType?: 'hwp' | 'hwpx' }) {
  const buffer = await readFile(input.path);
  return parseHwpWithRhwp({ buffer, filename: input.filename, sourceType: input.sourceType });
}
