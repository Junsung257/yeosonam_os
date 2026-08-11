import { describe, expect, it } from 'vitest';

import type { DocumentIR, DocumentIrTableCell } from './types';
import { buildDocumentIrTableCommercialTerms } from './table-grid-commercial-terms';

function cell(id: string, row: number, column: number, text: string, colSpan = 1): DocumentIrTableCell {
  return {
    id,
    row,
    column,
    rowSpan: 1,
    colSpan,
    text,
    nodeId: id,
    evidence: { page: 1, quoteHash: id.padEnd(64, 'a').slice(0, 64) },
  };
}

describe('DocumentIR table-grid commercial terms', () => {
  it('binds HWP table values to inclusion and exclusion headers', () => {
    const cells = [
      cell('included-heading', 0, 0, '포 함 내 역'),
      cell('included-value', 0, 1, '왕복 항공료+유류+TAX, 여행자보험\n호텔2인1실, 호텔조식', 5),
      cell('excluded-heading', 1, 0, '불포함 내역'),
      cell('excluded-value', 1, 1, '클럽 중식, 석식, 기타 개인비용, 싱글차지 1인/1박/4만원', 5),
    ];
    const rawText = cells.map(item => item.text).join('\n');
    const documentIr: DocumentIR = {
      version: 'v4',
      filename: 'matsuyama.hwp',
      sourceType: 'hwp',
      pages: 1,
      text: rawText,
      nodes: [],
      assets: [],
      parser: { engine: 'rhwp-wasm', version: '0.8.2' },
      tables: [{ id: 'commercial-table', rows: 2, columns: 6, cells }],
    };

    const result = buildDocumentIrTableCommercialTerms({ documentIr, sectionRawText: rawText });

    expect(result?.inclusions.map(item => item.value)).toEqual([
      '왕복 항공료+유류+TAX', '여행자보험', '호텔2인1실', '호텔조식',
    ]);
    expect(result?.exclusions.map(item => item.value)).toEqual([
      '클럽 중식', '석식', '기타 개인비용', '싱글차지 1인/1박/4만원',
    ]);
    expect(result?.inclusions[0]?.evidence).toMatchObject({
      table_id: 'commercial-table',
      node_id: 'included-value',
      extraction_method: 'document_ir_table_cell',
    });
  });

  it('fails closed when multiple commercial tables match one section', () => {
    const first = [
      cell('a-heading', 0, 0, '포함'), cell('a-value', 0, 1, '항공료'),
      cell('a-ex-heading', 1, 0, '불포함'), cell('a-ex-value', 1, 1, '개인경비'),
    ];
    const second = [
      cell('b-heading', 0, 0, '포함'), cell('b-value', 0, 1, '호텔'),
      cell('b-ex-heading', 1, 0, '불포함'), cell('b-ex-value', 1, 1, '중식'),
    ];
    const rawText = [...first, ...second].map(item => item.text).join('\n');
    const documentIr: DocumentIR = {
      version: 'v4', filename: 'multi.hwp', sourceType: 'hwp', pages: 1, text: rawText,
      nodes: [], assets: [], parser: { engine: 'rhwp-wasm', version: '0.8.2' },
      tables: [
        { id: 'first', rows: 2, columns: 2, cells: first },
        { id: 'second', rows: 2, columns: 2, cells: second },
      ],
    };

    expect(buildDocumentIrTableCommercialTerms({ documentIr, sectionRawText: rawText })).toBeNull();
  });
});
