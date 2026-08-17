import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { HwpDocument, initSync } from '@rhwp/core';

import { createTextDocumentIR, sha256Hex } from './document-ir';
import type { DocumentIR, DocumentIrNode, DocumentIrTable, ProductSourceType } from './types';
import { PRODUCT_REGISTRATION_V4_PARSER_VERSION } from './types';

type RhwpLayoutRun = {
  text?: string;
  x?: number;
  y?: number;
  secIdx?: number;
  paraIdx?: number;
  charStart?: number;
  parentParaIdx?: number;
  controlIdx?: number;
  cellIdx?: number;
  cellParaIdx?: number;
};

type RhwpPageLayout = { runs?: RhwpLayoutRun[] };
type RhwpTableDimensions = { rowCount?: number; colCount?: number; cellCount?: number };
type RhwpCellInfo = { row?: number; col?: number; rowSpan?: number; colSpan?: number };

type RhwpDocumentReader = Pick<
  HwpDocument,
  'pageCount' | 'getPageTextLayout' | 'getTableDimensions' | 'getCellInfo'
>;

export type RhwpWasmTolerantWarning = {
  code: 'INVALID_TABLE_CONTROL' | 'INVALID_TABLE_CELL';
  tableKey: string;
  cellIndex?: number;
  critical: boolean;
  detail: string;
};

let wasmInitialized = false;

function pushRootAndParents(target: string[], value: string | undefined): void {
  if (!value) return;
  let current = resolve(value);
  for (let depth = 0; depth < 10; depth += 1) {
    if (!target.includes(current)) target.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export function getRhwpWasmCandidates(input: {
  cwd?: string;
  lambdaTaskRoot?: string;
  argvEntry?: string;
} = {}): string[] {
  const roots: string[] = [];
  pushRootAndParents(roots, input.cwd ?? process.cwd());
  pushRootAndParents(roots, input.lambdaTaskRoot ?? process.env.LAMBDA_TASK_ROOT);
  pushRootAndParents(roots, dirname(input.argvEntry ?? process.argv[1] ?? process.cwd()));
  return roots.map(root => join(root, 'node_modules', '@rhwp', 'core', 'rhwp_bg.wasm'));
}

function resolveRhwpWasm(): string {
  const configured = process.env.RHWP_WASM_PATH?.trim();
  if (configured) return configured;
  const bundled = getRhwpWasmCandidates().find(candidate => existsSync(candidate));
  if (bundled) return bundled;
  throw new Error(`HWP_WASM_UNAVAILABLE:${JSON.stringify({ cwd: process.cwd() })}`);
}

function ensureRhwpWasmInitialized(): string {
  const wasmPath = resolveRhwpWasm();
  if (!wasmInitialized) {
    const measureTarget = globalThis as typeof globalThis & {
      measureTextWidth?: (font: string, text: string) => number;
    };
    if (typeof measureTarget.measureTextWidth !== 'function') {
      measureTarget.measureTextWidth = (font, text) => {
        const fontSize = Number.parseFloat(font.match(/([0-9.]+)px/)?.[1] ?? '16');
        return Array.from(text).reduce((width, character) => (
          width + (/^[\u0000-\u00ff]$/.test(character) ? fontSize * 0.55 : fontSize)
        ), 0);
      };
    }
    initSync({ module: readFileSync(wasmPath) });
    wasmInitialized = true;
  }
  return wasmPath;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`RHWP_WASM_${label}_INVALID_JSON:${error instanceof Error ? error.message : String(error)}`);
  }
}

type TextGroup = {
  key: string;
  page: number;
  x: number;
  y: number;
  section: number;
  paragraph: number;
  parentParagraph?: number;
  control?: number;
  cell?: number;
  cellParagraph?: number;
  runs: RhwpLayoutRun[];
};

function tableKey(section: number, parentParagraph: number, control: number): string {
  return `${section}:${parentParagraph}:${control}`;
}

function groupLayoutRuns(layouts: RhwpPageLayout[]): TextGroup[] {
  const groups = new Map<string, TextGroup>();
  layouts.forEach((layout, page) => {
    for (const run of layout.runs ?? []) {
      const text = String(run.text ?? '');
      if (!text) continue;
      const section = numberOrZero(run.secIdx);
      const paragraph = numberOrZero(run.paraIdx);
      const hasCell = Number.isInteger(run.parentParaIdx)
        && Number.isInteger(run.controlIdx)
        && Number.isInteger(run.cellIdx);
      const key = hasCell
        ? `cell:${section}:${run.parentParaIdx}:${run.controlIdx}:${run.cellIdx}:${numberOrZero(run.cellParaIdx)}`
        : `paragraph:${section}:${paragraph}:${page}`;
      const existing = groups.get(key);
      if (existing) {
        existing.runs.push(run);
        existing.x = Math.min(existing.x, numberOrZero(run.x));
        existing.y = Math.min(existing.y, numberOrZero(run.y));
        continue;
      }
      groups.set(key, {
        key,
        page,
        x: numberOrZero(run.x),
        y: numberOrZero(run.y),
        section,
        paragraph,
        parentParagraph: hasCell ? numberOrZero(run.parentParaIdx) : undefined,
        control: hasCell ? numberOrZero(run.controlIdx) : undefined,
        cell: hasCell ? numberOrZero(run.cellIdx) : undefined,
        cellParagraph: hasCell ? numberOrZero(run.cellParaIdx) : undefined,
        runs: [run],
      });
    }
  });
  return [...groups.values()].sort((left, right) => (
    left.page - right.page || left.y - right.y || left.x - right.x || left.key.localeCompare(right.key)
  ));
}

function groupText(group: TextGroup): string {
  return group.runs
    .slice()
    .sort((left, right) => numberOrZero(left.charStart) - numberOrZero(right.charStart) || numberOrZero(left.x) - numberOrZero(right.x))
    .map(run => String(run.text ?? ''))
    .join('')
    .replace(/\r\n?/g, '\n')
    .trim();
}

export function buildRhwpWasmDocumentIR(input: {
  document: RhwpDocumentReader;
  filename: string;
  sourceType: Extract<ProductSourceType, 'hwp' | 'hwpx'>;
}): DocumentIR {
  const pageCount = input.document.pageCount();
  const layouts = Array.from({ length: pageCount }, (_, page) => (
    parseJson<RhwpPageLayout>(input.document.getPageTextLayout(page), `PAGE_${page}_LAYOUT`)
  ));
  const groups = groupLayoutRuns(layouts);
  const text = groups.map(groupText).filter(Boolean).join('\n');
  if (text.length < 10) throw new Error('HWP_TEXT_TOO_SHORT');

  const base = createTextDocumentIR({
    filename: input.filename,
    sourceType: input.sourceType,
    text,
    parserEngine: 'rhwp-wasm',
    parserVersion: PRODUCT_REGISTRATION_V4_PARSER_VERSION,
  });
  base.pages = pageCount;
  base.nodes = [];
  base.tables = [];
  const tolerantWarnings: RhwpWasmTolerantWarning[] = [];

  for (let page = 0; page < pageCount; page += 1) {
    base.nodes.push({ id: `page-${page}`, kind: 'page', page, order: base.nodes.length });
  }

  for (const group of groups.filter(item => item.cell === undefined)) {
    const paragraphText = groupText(group);
    if (!paragraphText) continue;
    base.nodes.push({
      id: `paragraph-${group.section}-${group.paragraph}-${sha256Hex(paragraphText).slice(0, 12)}`,
      kind: 'paragraph',
      text: paragraphText,
      page: group.page,
      parentId: `page-${group.page}`,
      order: base.nodes.length,
      attributes: { section: group.section, paragraph: group.paragraph },
    });
  }

  const tableGroups = new Map<string, TextGroup[]>();
  for (const group of groups.filter(item => item.cell !== undefined)) {
    const key = tableKey(group.section, group.parentParagraph ?? 0, group.control ?? 0);
    const list = tableGroups.get(key) ?? [];
    list.push(group);
    tableGroups.set(key, list);
  }

  for (const [key, cellGroups] of tableGroups) {
    const [section, parentParagraph, control] = key.split(':').map(Number);
    let dimensions: RhwpTableDimensions;
    try {
      dimensions = parseJson<RhwpTableDimensions>(
        input.document.getTableDimensions(section, parentParagraph, control),
        `TABLE_${key}_DIMENSIONS`,
      );
    } catch (error) {
      const tableText = cellGroups.map(groupText).filter(Boolean).join('\n');
      tolerantWarnings.push({
        code: 'INVALID_TABLE_CONTROL',
        tableKey: key,
        critical: /(?:\d{1,3}(?:,\d{3})+\s*원?|출발일|성인|아동|포함|불포함|취소|환불|DAY\s*\d+|\d+\s*일차)/iu.test(tableText),
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const rows = numberOrZero(dimensions.rowCount);
    const columns = numberOrZero(dimensions.colCount);
    const cellCount = numberOrZero(dimensions.cellCount);
    if (rows < 1 || columns < 1 || cellCount < 1) continue;
    const page = Math.min(...cellGroups.map(group => group.page));
    const tableId = `table-${section}-${parentParagraph}-${control}`;
    const table: DocumentIrTable = { id: tableId, page, rows, columns, cells: [] };
    const tableNode: DocumentIrNode = {
      id: tableId,
      kind: 'table',
      page,
      parentId: `page-${page}`,
      order: base.nodes.length,
      attributes: { rows, columns, section, parentParagraph, control },
    };
    base.nodes.push(tableNode);

    for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
      const matching = cellGroups
        .filter(group => group.cell === cellIndex)
        .sort((left, right) => numberOrZero(left.cellParagraph) - numberOrZero(right.cellParagraph));
      const cellText = matching.map(groupText).filter(Boolean).join('\n');
      let info: RhwpCellInfo;
      try {
        info = parseJson<RhwpCellInfo>(
          input.document.getCellInfo(section, parentParagraph, control, cellIndex),
          `TABLE_${key}_CELL_${cellIndex}`,
        );
      } catch (error) {
        tolerantWarnings.push({
          code: 'INVALID_TABLE_CELL',
          tableKey: key,
          cellIndex,
          critical: /(?:\d{1,3}(?:,\d{3})+\s*원?|출발일|성인|아동|포함|불포함|취소|환불|DAY\s*\d+|\d+\s*일차)/iu.test(cellText),
          detail: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      const cellPage = matching.length > 0 ? Math.min(...matching.map(group => group.page)) : page;
      const row = numberOrZero(info.row);
      const column = numberOrZero(info.col);
      const cellId = `${tableId}-cell-${cellIndex}`;
      base.nodes.push({
        id: cellId,
        kind: 'cell',
        text: cellText,
        page: cellPage,
        parentId: tableId,
        order: base.nodes.length,
        attributes: {
          row,
          column,
          rowSpan: Math.max(1, numberOrZero(info.rowSpan)),
          colSpan: Math.max(1, numberOrZero(info.colSpan)),
        },
      });
      table.cells.push({
        id: cellId,
        row,
        column,
        rowSpan: Math.max(1, numberOrZero(info.rowSpan)),
        colSpan: Math.max(1, numberOrZero(info.colSpan)),
        text: cellText,
        nodeId: cellId,
        evidence: { page: cellPage, quoteHash: sha256Hex(cellText) },
      });
    }
    base.tables.push(table);
  }

  if (tolerantWarnings.length > 0) {
    base.assets.push({
      id: 'rhwp-wasm-tolerant-warnings',
      kind: 'image',
      metadata: {
        warningCount: tolerantWarnings.length,
        criticalWarningCount: tolerantWarnings.filter(warning => warning.critical).length,
        warnings: tolerantWarnings,
      },
    });
  }

  return base;
}

export function getRhwpWasmTolerantWarnings(ir: DocumentIR): RhwpWasmTolerantWarning[] {
  const metadata = ir.assets.find(asset => asset.id === 'rhwp-wasm-tolerant-warnings')?.metadata;
  if (!metadata || !Array.isArray(metadata.warnings)) return [];
  return metadata.warnings.filter((warning): warning is RhwpWasmTolerantWarning => (
    Boolean(warning) && typeof warning === 'object' && typeof warning.code === 'string'
  ));
}

export async function parseHwpWithRhwpWasm(input: {
  buffer: Buffer;
  filename: string;
  sourceType?: Extract<ProductSourceType, 'hwp' | 'hwpx'>;
}): Promise<{ text: string; ir: DocumentIR; parserBinary: string }> {
  const wasmPath = ensureRhwpWasmInitialized();
  let document: HwpDocument | null = null;
  try {
    document = new HwpDocument(new Uint8Array(input.buffer));
    const ir = buildRhwpWasmDocumentIR({
      document,
      filename: input.filename,
      sourceType: input.sourceType ?? (input.filename.toLowerCase().endsWith('.hwpx') ? 'hwpx' : 'hwp'),
    });
    return { text: ir.text, ir, parserBinary: wasmPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`RHWP_WASM_PARSE_FAILED:${message}`);
  } finally {
    document?.free();
  }
}
