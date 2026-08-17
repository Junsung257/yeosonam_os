import { describe, expect, it } from 'vitest';

import type { DocumentIR, DocumentIrNode, DocumentIrTableCell } from './types';
import {
  buildDocumentIrTableCommercialTerms,
  buildDocumentIrTableCommercialTermsByDuration,
  documentIrTableDurationDays,
} from './table-grid-commercial-terms';

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

  it('does not split a thousands-formatted surcharge inside an exclusion item', () => {
    const cells = [
      cell('included-heading', 0, 0, '포함'),
      cell('included-value', 0, 1, '항공료, 호텔'),
      cell('excluded-heading', 1, 0, '불포함'),
      cell('excluded-value', 1, 1, '싱글차지(200,000원/인/전일정), 기사 가이드팁'),
    ];
    const rawText = cells.map(item => item.text).join('\n');
    const documentIr: DocumentIR = {
      version: 'v4', filename: 'thousands.hwp', sourceType: 'hwp', pages: 1, text: rawText,
      nodes: [], assets: [], parser: { engine: 'rhwp-wasm', version: '0.8.2' },
      tables: [{ id: 'commercial-table', rows: 2, columns: 2, cells }],
    };

    const result = buildDocumentIrTableCommercialTerms({ documentIr, sectionRawText: rawText });

    expect(result?.exclusions.map(item => item.value)).toEqual([
      '싱글차지(200,000원/인/전일정)',
      '기사 가이드팁',
    ]);
  });

  it('reuses exact repeated commercial terms without inventing a merged value', () => {
    const first = [
      cell('a-heading', 0, 0, '포함'), cell('a-value', 0, 1, '항공료'),
      cell('a-ex-heading', 1, 0, '불포함'), cell('a-ex-value', 1, 1, '개인경비'),
    ];
    const second = [
      cell('b-heading', 0, 0, '포함'), cell('b-value', 0, 1, '항공료'),
      cell('b-ex-heading', 1, 0, '불포함'), cell('b-ex-value', 1, 1, '개인경비'),
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

    expect(buildDocumentIrTableCommercialTerms({ documentIr, sectionRawText: rawText })).toMatchObject({
      inclusions: [expect.objectContaining({ value: '항공료' })],
      exclusions: [expect.objectContaining({ value: '개인경비' })],
    });
  });

  it('fails closed when multiple tables disagree on commercial terms', () => {
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
      version: 'v4', filename: 'conflict.hwp', sourceType: 'hwp', pages: 1, text: rawText,
      nodes: [], assets: [], parser: { engine: 'rhwp-wasm', version: '0.8.2' },
      tables: [
        { id: 'first', rows: 2, columns: 2, cells: first },
        { id: 'second', rows: 2, columns: 2, cells: second },
      ],
    };

    expect(buildDocumentIrTableCommercialTerms({ documentIr, sectionRawText: rawText })).toBeNull();
  });

  it('uses node order to bind repeated terms to the current catalog section', () => {
    const first = [
      cell('a-heading', 0, 0, '포함'), cell('a-value', 0, 1, '항공료'),
      cell('a-ex-heading', 1, 0, '불포함'), cell('a-ex-value', 1, 1, '개인경비'),
    ];
    const second = [
      cell('b-heading', 0, 0, '포함'), cell('b-value', 0, 1, '항공료'),
      cell('b-ex-heading', 1, 0, '불포함'), cell('b-ex-value', 1, 1, '개인경비'),
    ];
    const nodes: DocumentIrNode[] = [
      { id: 'first', kind: 'table', order: 0 },
      { id: 'title-a', kind: 'cell', order: 1, text: '상품 A 3박5일' },
      { id: 'a-heading', kind: 'cell', order: 3, text: '포함' },
      { id: 'a-value', kind: 'cell', order: 4, text: '항공료' },
      { id: 'a-ex-heading', kind: 'cell', order: 5, text: '불포함' },
      { id: 'a-ex-value', kind: 'cell', order: 6, text: '개인경비' },
      { id: 'unique-a', kind: 'cell', order: 8, text: 'A 전용 일정' },
      { id: 'second', kind: 'table', order: 9 },
      { id: 'title-b', kind: 'cell', order: 10, text: '베트남<사파2박+하노이1박> 상품 B PKG' },
      { id: 'b-heading', kind: 'cell', order: 12, text: '포함' },
      { id: 'b-value', kind: 'cell', order: 13, text: '항공료' },
      { id: 'b-ex-heading', kind: 'cell', order: 14, text: '불포함' },
      { id: 'b-ex-value', kind: 'cell', order: 15, text: '개인경비' },
      { id: 'unique-b', kind: 'cell', order: 18, text: 'B 전용 일정' },
    ];
    const documentIr: DocumentIR = {
      version: 'v4', filename: 'repeated.hwp', sourceType: 'hwp', pages: 1,
      text: '상품 A 3박5일\n항공료\n개인경비\nA 전용 일정\n베트남<사파2박+하노이1박> 상품 B PKG\n항공료\n개인경비\nB 전용 일정',
      nodes, assets: [], parser: { engine: 'rhwp-wasm', version: '0.8.2' },
      tables: [
        { id: 'first', rows: 2, columns: 2, cells: first },
        { id: 'second', rows: 2, columns: 2, cells: second },
      ],
    };

    const result = buildDocumentIrTableCommercialTerms({
      documentIr,
      sectionRawText: '공통 가격표\n\n---\n\n상품 A 3박5일\n포함\n항공료\n불포함\n개인경비\nA 전용 일정',
    });

    expect(result?.tableId).toBe('first');
    expect(result?.exclusions.map(item => item.value)).toEqual(['개인경비']);
  });

  it('uses product-specific table content when duplicated terms are identical', () => {
    const first = [
      cell('a-heading', 0, 0, '포함'), cell('a-value', 0, 1, '항공료'),
      cell('a-ex-heading', 1, 0, '불포함'), cell('a-ex-value', 1, 1, '개인경비'),
      cell('a-hotel', 2, 0, '소아루리조트 온천욕과 BBQ 석식'),
    ];
    const second = [
      cell('b-heading', 0, 0, '포함'), cell('b-value', 0, 1, '항공료'),
      cell('b-ex-heading', 1, 0, '불포함'), cell('b-ex-value', 1, 1, '개인경비'),
      cell('b-hotel', 2, 0, '토요코인 이즈하라 시내숙박'),
    ];
    const documentIr: DocumentIR = {
      version: 'v4', filename: 'tsushima.hwp', sourceType: 'hwp', pages: 2,
      text: '소아루리조트 온천욕과 BBQ 석식\n항공료\n개인경비\n토요코인 이즈하라 시내숙박\n항공료\n개인경비',
      nodes: [], assets: [], parser: { engine: 'rhwp-wasm', version: '0.8.2' },
      tables: [
        { id: 'first', rows: 3, columns: 2, cells: first },
        { id: 'second', rows: 3, columns: 2, cells: second },
      ],
    };

    const result = buildDocumentIrTableCommercialTerms({
      documentIr,
      sectionRawText: '소아루리조트 온천욕과 BBQ 석식\n포함\n항공료\n불포함\n개인경비',
    });

    expect(result?.tableId).toBe('first');
  });

  it('binds conflicting repeated terms to distinct itinerary durations', () => {
    const first = [
      cell('a-heading', 0, 0, '포함'), cell('a-value', 0, 1, '항공료'),
      cell('a-ex-heading', 1, 0, '불포함'), cell('a-ex-value', 1, 1, '싱글차지 $75'),
      cell('a-day', 2, 0, '제5일'),
    ];
    const second = [
      cell('b-heading', 0, 0, '포함'), cell('b-value', 0, 1, '항공료'),
      cell('b-ex-heading', 1, 0, '불포함'), cell('b-ex-value', 1, 1, '싱글차지 $130'),
      cell('b-day', 2, 0, '제6일'),
    ];
    const rawText = [...first, ...second].map(item => item.text).join('\n');
    const documentIr: DocumentIR = {
      version: 'v4', filename: 'duration-variants.hwp', sourceType: 'hwp', pages: 2, text: rawText,
      nodes: [], assets: [], parser: { engine: 'rhwp-wasm', version: '0.8.2' },
      tables: [
        { id: 'five-days', rows: 3, columns: 2, cells: first },
        { id: 'six-days', rows: 3, columns: 2, cells: second },
      ],
    };

    expect(buildDocumentIrTableCommercialTermsByDuration({ documentIr, sectionRawText: rawText }))
      .toEqual([
        expect.objectContaining({ tableId: 'five-days', durationDays: 5 }),
        expect.objectContaining({ tableId: 'six-days', durationDays: 6 }),
      ]);
  });

  it('reads duration from a commercial-table title without treating a date as duration', () => {
    const fiveDay = [
      cell('a-title', 0, 0, '[\uB178\uC635\uC158+\uB178\uD301] \uACC4\uB9BC/\uC774\uAC15\uC720\uB78C 5\uC77C \u2013 LJ'),
      cell('a-date-heading', 1, 0, '\uCD9C \uBC1C \uC77C \uC790'), cell('a-date', 1, 1, '26\uB144 4\uC6D4 3\uC77C ~ 5\uC6D4 30\uC77C (\uD654\uC694\uC77C \uCD9C\uBC1C)'),
      cell('a-heading', 2, 0, '\uD3EC \uD568 \uC0AC \uD56D'), cell('a-value', 2, 1, '\uD56D\uACF5\uB8CC, \uD638\uD154'),
      cell('a-ex-heading', 3, 0, '\uBD88\uD3EC\uD568 \uC0AC\uD56D'), cell('a-ex-value', 3, 1, '\uC2F1\uAE00\uCC28\uC9C0 $75'),
    ];
    const sixDay = [
      cell('b-title', 0, 0, '[\uB178\uC635\uC158+\uB178\uD301] \uACC4\uB9BC/\uC6A9\uC2B9 6\uC77C - LJ'),
      cell('b-date-heading', 1, 0, '\uCD9C \uBC1C \uC77C \uC790'), cell('b-date', 1, 1, '26\uB144 4\uC6D4 3\uC77C ~ 5\uC6D4 30\uC77C (\uAE08\uC694\uC77C \uCD9C\uBC1C)'),
      cell('b-heading', 2, 0, '\uD3EC \uD568 \uC0AC \uD56D'), cell('b-value', 2, 1, '\uD56D\uACF5\uB8CC, \uD638\uD154'),
      cell('b-ex-heading', 3, 0, '\uBD88\uD3EC\uD568 \uC0AC\uD56D'), cell('b-ex-value', 3, 1, '\uC2F1\uAE00\uCC28\uC9C0 $130'),
    ];
    const rawText = [...fiveDay, ...sixDay].map(item => item.text).join('\n');
    const documentIr: DocumentIR = {
      version: 'v4', filename: 'guilin.hwp', sourceType: 'hwp', pages: 2, text: rawText,
      nodes: [], assets: [], parser: { engine: 'rhwp-wasm', version: '0.8.2' },
      tables: [
        { id: 'five-days', rows: 4, columns: 2, cells: fiveDay },
        { id: 'six-days', rows: 4, columns: 2, cells: sixDay },
      ],
    };

    expect(buildDocumentIrTableCommercialTermsByDuration({ documentIr, sectionRawText: rawText }))
      .toEqual([
        expect.objectContaining({ tableId: 'five-days', durationDays: 5, departureWeekdays: [2] }),
        expect.objectContaining({ tableId: 'six-days', durationDays: 6, departureWeekdays: [5] }),
      ]);
  });

  it('keeps the explicit product-title duration when itinerary DAY labels are duplicated', () => {
    const cells = [
      cell('title', 0, 0, '프리미엄 Premium'),
      cell('product', 0, 1, '성도,구채구,황룡,낙산 6일\n#노팁 #노옵션'),
      cell('included-heading', 1, 0, '포함 내역'), cell('included', 1, 1, '항공료, 호텔'),
      cell('excluded-heading', 2, 0, '불포함 내역'), cell('excluded', 2, 1, '개인경비'),
      cell('day-one', 3, 0, '제1일'),
      cell('day-two', 4, 0, '제2일'),
      cell('day-two-duplicate', 5, 0, '제2일'),
      cell('day-three', 6, 0, '제3일'),
      cell('day-four', 7, 0, '제4일'),
      cell('day-five', 8, 0, '제5일'),
    ];

    expect(documentIrTableDurationDays({ id: 'six-day-product', rows: 9, columns: 2, cells }))
      .toBe(6);
  });
});
