import { describe, expect, it } from 'vitest';

import { buildRhwpWasmDocumentIR, getRhwpWasmCandidates, getRhwpWasmTolerantWarnings } from './rhwp-wasm';

describe('rhwp WASM EvidenceIR adapter', () => {
  it('discovers the pinned WASM module from the Lambda task root', () => {
    const normalized = getRhwpWasmCandidates({
      cwd: '/var/task/.next/server/app/.well-known/workflow/v1/step',
      lambdaTaskRoot: '/var/task',
      argvEntry: '/var/runtime/index.mjs',
    }).map(candidate => candidate.replaceAll('\\', '/'));

    expect(normalized.some(candidate => candidate.endsWith('/var/task/node_modules/@rhwp/core/rhwp_bg.wasm'))).toBe(true);
  });

  it('preserves visual text order and reconstructs merged table cells', () => {
    const ir = buildRhwpWasmDocumentIR({
      filename: 'sample.hwp',
      sourceType: 'hwp',
      document: {
        pageCount: () => 1,
        getPageTextLayout: () => JSON.stringify({
          runs: [
            { text: '마쓰야마 골프', x: 10, y: 10, secIdx: 0, paraIdx: 0, charStart: 0 },
            { text: '출발일', x: 10, y: 30, secIdx: 0, parentParaIdx: 1, controlIdx: 0, cellIdx: 0, cellParaIdx: 0, charStart: 0 },
            { text: '8/28', x: 100, y: 30, secIdx: 0, parentParaIdx: 1, controlIdx: 0, cellIdx: 1, cellParaIdx: 0, charStart: 0 },
            { text: ' 999,000원', x: 130, y: 30, secIdx: 0, parentParaIdx: 1, controlIdx: 0, cellIdx: 1, cellParaIdx: 0, charStart: 4 },
          ],
        }),
        getTableDimensions: () => JSON.stringify({ rowCount: 1, colCount: 2, cellCount: 2 }),
        getCellInfo: (_section, _paragraph, _control, cell) => JSON.stringify(
          cell === 0
            ? { row: 0, col: 0, rowSpan: 1, colSpan: 1 }
            : { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
        ),
      },
    });

    expect(ir.parser).toEqual({ engine: 'rhwp-wasm', version: '0.8.2' });
    expect(ir.text).toContain('마쓰야마 골프');
    expect(ir.text).toContain('8/28 999,000원');
    expect(ir.tables).toHaveLength(1);
    expect(ir.tables[0]).toMatchObject({ rows: 1, columns: 2 });
    expect(ir.tables[0].cells[1]).toMatchObject({ row: 0, column: 1, text: '8/28 999,000원' });
    expect(ir.tables[0].cells[1].evidence.quoteHash).toHaveLength(64);
  });

  it('keeps readable page text when a malformed table control is encountered', () => {
    const ir = buildRhwpWasmDocumentIR({
      filename: 'malformed-table-control.hwp',
      sourceType: 'hwp',
      document: {
        pageCount: () => 1,
        getPageTextLayout: () => JSON.stringify({
          runs: [
            { text: '다낭 패키지 일정', x: 10, y: 10, secIdx: 0, paraIdx: 0, charStart: 0 },
            { text: '장식 표', x: 10, y: 30, secIdx: 0, parentParaIdx: 1, controlIdx: 9, cellIdx: 0, cellParaIdx: 0, charStart: 0 },
          ],
        }),
        getTableDimensions: () => { throw new Error('지정된 컨트롤이 표가 아닙니다'); },
        getCellInfo: () => JSON.stringify({ row: 0, col: 0, rowSpan: 1, colSpan: 1 }),
      },
    });

    expect(ir.text).toContain('다낭 패키지 일정');
    expect(getRhwpWasmTolerantWarnings(ir)).toEqual([
      expect.objectContaining({ code: 'INVALID_TABLE_CONTROL', critical: false }),
    ]);
  });
});
