import { describe, expect, it } from 'vitest';

import type { DocumentIR, DocumentIrTable } from './types';
import {
  buildDocumentIrTablePriceCalendarCandidates,
  buildDocumentIrTablePriceCalendars,
  parseDurationGradeRangePriceMatrix,
  sourcePriceAvailabilityStatus,
} from './table-grid-price-calendar';

function documentIr(): DocumentIR {
  const rows = [
    ['\uD328\uD134', '\uCD9C\uBC1C\uC77C', '', '', '\uD638\uD154'],
    ['5\uC77C', '7/1-22', '', '\uC77C/\uAE08 \uCD9C\uBC1C', '1,139,000\uC6D0'],
    ['', '7/23-8/3', '', '', '1,229,000\uC6D0'],
    ['6\uC77C', '8/16-29\n10/1-24', '', '\uC6D4/\uC218 \uCD9C\uBC1C', '1,159,000\uC6D0'],
    ['\uD2B9\uC1A1\uC77C', '9/21(\uC6D4)', '', '1,419,000\uC6D0', ''],
    ['\uC2F1\uAE00\uCC28\uC9C0', '9/21', '', '200,000\uC6D0', ''],
  ];
  const cells = rows.flatMap((values, row) => values.flatMap((text, column) => text ? [{
    id: `cell-${row}-${column}`,
    nodeId: `node-${row}-${column}`,
    row,
    column,
    rowSpan: 1,
    colSpan: 1,
    text,
    evidence: { page: 0, quoteHash: `${row}-${column}` },
  }] : []));
  const text = `26\uB144 7\uC6D4~10\uC6D4\n${cells.map(cell => cell.text).join('\n')}`;
  return {
    version: 'v4',
    sourceType: 'hwp',
    filename: 'price.hwp',
    text,
    pages: 1,
    parser: { engine: 'test', version: '1' },
    nodes: [],
    tables: [{ id: 'price-table', page: 0, rows: rows.length, columns: 5, cells }],
    assets: [],
  };
}

describe('buildDocumentIrTablePriceCalendars', () => {
  it.each([
    ['별도문의', 'inquiry'],
    ['마감', 'sold_out'],
    ['매진', 'sold_out'],
    ['비운항', 'not_operating'],
    ['항공 제외일', 'not_operating'],
    ['599,000원', 'available'],
  ] as const)('classifies source availability %s without inventing a sale price', (source, expected) => {
    expect(sourcePriceAvailabilityStatus(source)).toBe(expected);
  });

  it('keeps a no-option price column as an independent source product axis', () => {
    const rows = [
      ['출발일 & 2박3일', '', '실속', '노옵션', '품격(노노노)'],
      ['5월', '월,화,수', '349,000', '569,000', '699,000'],
      ['5월', '5/5', '699,000', '849,000', '999,000'],
    ];
    const cells = rows.flatMap((values, row) => values.flatMap((text, column) => text ? [{
      id: `no-option-axis-cell-${row}-${column}`,
      nodeId: `no-option-axis-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text,
      evidence: { page: 0, quoteHash: `no-option-axis-${row}-${column}` },
    }] : []));
    const text = `2027년 청도 2박3일 가격표\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'no-option-axis.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'no-option-axis', page: 0, rows: rows.length, columns: 5, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({
      documentIr: ir,
      sectionRawText: text,
      fallbackYear: 2027,
      fallbackDurationDays: 3,
    });

    expect(result.map(calendar => calendar.gradeLabel)).toEqual(['노옵션', '실속', '품격']);
    expect(result.find(calendar => calendar.gradeLabel === '노옵션')?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2027-05-05', amount: 849_000 }),
    ]));
  });

  it('parses month/day rosters under named package columns without an 출발일 header', () => {
    const rows = [
      ['날짜', '', '', '1일자유 싱가폴3박', '전일관광 싱가폴3박'],
      ['8월', '16,17,18', '', '1,119,000', '1,319,000'],
      ['', '22,23', '', '1,099,000', '1,239,000'],
    ];
    const cells = rows.flatMap((values, row) => values.flatMap((text, column) => text ? [{
      id: `named-month-${row}-${column}`,
      nodeId: `named-month-node-${row}-${column}`,
      row,
      column,
      rowSpan: row === 1 && column === 0 ? 2 : 1,
      colSpan: row === 0 && column === 0 ? 3 : 1,
      text,
      evidence: { page: 0, quoteHash: `named-month-${row}-${column}` },
    }] : []));
    const text = `2026년 싱가포르 3박5일\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'named-month.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'named-month', page: 0, rows: rows.length, columns: 5, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({
      documentIr: ir,
      sectionRawText: text,
      fallbackYear: 2026,
      fallbackDurationDays: 5,
    });

    expect(result.map(calendar => calendar.gradeLabel)).toEqual([
      '1일자유 싱가폴3박',
      '전일관광 싱가폴3박',
    ]);
    expect(result[0]?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-08-16', amount: 1_119_000 }),
      expect.objectContaining({ date: '2026-08-23', amount: 1_099_000 }),
    ]));
  });

  it('binds a one-off date and shorthand sale amount from the same source cell', () => {
    const cell = {
      id: 'one-off-cell', nodeId: 'one-off-node', row: 0, column: 0,
      rowSpan: 1, colSpan: 1,
      text: '9월15일 단하루!! 선착순20명 399.000원',
      evidence: { page: 0, quoteHash: 'one-off-quote' },
    };
    const text = `2026년 다낭 3박5일\n${cell.text}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'one-off.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'one-off', page: 0, rows: 1, columns: 1, cells: [cell] }], assets: [],
    };
    const result = buildDocumentIrTablePriceCalendars({
      documentIr: ir,
      sectionRawText: text,
      fallbackYear: 2026,
      fallbackDurationDays: 5,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.prices).toEqual([
      expect.objectContaining({ date: '2026-09-15', amount: 399_000 }),
    ]);
  });

  it('reads row-spanned duration/month cells with a single price column', () => {
    const values = [
      { row: 0, column: 0, rowSpan: 1, text: '출발일' },
      { row: 0, column: 1, rowSpan: 1, text: '판매가' },
      { row: 1, column: 0, rowSpan: 3, text: '3박4일' },
      { row: 1, column: 1, rowSpan: 2, text: '8월' },
      { row: 1, column: 2, rowSpan: 1, text: '30일' },
      { row: 1, column: 3, rowSpan: 1, text: '829,000' },
      { row: 2, column: 2, rowSpan: 1, text: '31일' },
      { row: 2, column: 3, rowSpan: 1, text: '799,000' },
      { row: 3, column: 1, rowSpan: 1, text: '9월' },
      { row: 3, column: 2, rowSpan: 1, text: '19, 20, 21' },
      { row: 3, column: 3, rowSpan: 1, text: '899,000' },
      { row: 4, column: 0, rowSpan: 1, text: '4박5일' },
      { row: 4, column: 1, rowSpan: 1, text: '9월' },
      { row: 4, column: 2, rowSpan: 1, text: '1일' },
      { row: 4, column: 3, rowSpan: 1, text: '799,000' },
    ];
    const table: DocumentIrTable = {
      id: 'rowspan-duration-price', page: 0, rows: 5, columns: 4,
      cells: values.map((cell, index) => ({
        id: `cell-${index}`,
        nodeId: `node-${index}`,
        row: cell.row,
        column: cell.column,
        rowSpan: cell.rowSpan,
        colSpan: 1,
        text: cell.text,
        evidence: { page: 0, quoteHash: `quote-${index}` },
      })),
    };
    const text = `2026년 장가계 3박4일 4박5일\n${values.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'rowspan-duration.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [], tables: [table], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({
      documentIr: ir,
      sectionRawText: text,
      fallbackYear: 2026,
    });

    expect(result).toHaveLength(2);
    expect(result.find(calendar => calendar.durationDays === 4)?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-08-30', amount: 829_000 }),
      expect.objectContaining({ date: '2026-08-31', amount: 799_000 }),
      expect.objectContaining({ date: '2026-09-20', amount: 899_000 }),
    ]));
    expect(result.find(calendar => calendar.durationDays === 5)?.prices).toEqual([
      expect.objectContaining({ date: '2026-09-01', amount: 799_000 }),
    ]);
  });

  it('carries a stacked sale price across row-spanned month dates', () => {
    const values = [
      { row: 0, column: 0, text: '세부직항 레체팩 3박5일', rowSpan: 1 },
      { row: 1, column: 0, text: '출발일', rowSpan: 1 },
      { row: 1, column: 1, text: '요 금', rowSpan: 1 },
      { row: 2, column: 0, text: '3월', rowSpan: 1 },
      { row: 2, column: 1, text: '1,2,4,7,21,28', rowSpan: 2 },
      { row: 2, column: 2, text: '699,000↴\n599,000', rowSpan: 4 },
      { row: 3, column: 0, text: '4월', rowSpan: 1 },
      { row: 4, column: 0, text: '5월', rowSpan: 1 },
      { row: 4, column: 1, text: '9,17,19,26', rowSpan: 2 },
    ];
    const cells: DocumentIrTable['cells'] = values.map((cell, index) => ({
      id: `stacked-month-${index}`,
      nodeId: `stacked-month-${index}`,
      row: cell.row,
      column: cell.column,
      rowSpan: cell.rowSpan,
      colSpan: 1,
      text: cell.text,
      evidence: { page: 0, quoteHash: `stacked-month-${index}` },
    }));
    const text = `2026년 세부직항 레체팩 3박5일\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'stacked-month.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'stacked-month', page: 0, rows: 6, columns: 3, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({
      documentIr: ir,
      sectionRawText: text,
      fallbackYear: 2026,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-03-01', amount: 599_000, list_price: 699_000 }),
    ]));
  });

  it('parses supplier slash-wrapped date ranges and keeps the Korean crown grade axis', () => {
    const values = [
      { row: 0, column: 0, rowSpan: 1, text: '출발일' },
      { row: 0, column: 3, rowSpan: 1, text: '세이브' },
      { row: 0, column: 4, rowSpan: 1, text: '스탠다드' },
      { row: 0, column: 5, rowSpan: 1, text: '프리미엄' },
      { row: 0, column: 6, rowSpan: 1, text: '크라운' },
      { row: 1, column: 0, rowSpan: 3, text: '9/1/~/9/28' },
      { row: 1, column: 1, rowSpan: 3, text: '3박 4일' },
      { row: 1, column: 2, rowSpan: 1, text: '월' },
      { row: 1, column: 3, rowSpan: 1, text: '469,000' },
      { row: 1, column: 4, rowSpan: 1, text: '789,000' },
      { row: 1, column: 5, rowSpan: 1, text: '909,000' },
      { row: 1, column: 6, rowSpan: 1, text: '1,239,000' },
      { row: 2, column: 2, rowSpan: 1, text: '토' },
      { row: 2, column: 3, rowSpan: 1, text: '539,000' },
      { row: 2, column: 4, rowSpan: 1, text: '839,000' },
      { row: 2, column: 5, rowSpan: 1, text: '979,000' },
      { row: 2, column: 6, rowSpan: 1, text: '1,299,000' },
      { row: 3, column: 2, rowSpan: 1, text: '일' },
      { row: 3, column: 3, rowSpan: 1, text: '499,000' },
      { row: 3, column: 4, rowSpan: 1, text: '819,000' },
      { row: 3, column: 5, rowSpan: 1, text: '939,000' },
      { row: 3, column: 6, rowSpan: 1, text: '1,269,000' },
      { row: 4, column: 0, rowSpan: 1, text: '9/5' },
      { row: 4, column: 1, rowSpan: 1, text: '3박 4일' },
      { row: 4, column: 3, rowSpan: 1, text: '649,000' },
      { row: 4, column: 4, rowSpan: 1, text: '969,000' },
      { row: 4, column: 5, rowSpan: 1, text: '1,109,000' },
      { row: 4, column: 6, rowSpan: 1, text: '1,419,000' },
      { row: 7, column: 0, rowSpan: 1, text: '■세이브 [실속형 상품] : 기사가이드팁 현지 지불 / 쇼핑 3회' },
      { row: 8, column: 0, rowSpan: 1, text: '■크라운 [품격형 상품] : 노팁 / 노옵션 / 노쇼핑' },
    ];
    const cells = values.map((cell, index) => ({
      id: `slash-range-cell-${index}`,
      nodeId: `slash-range-node-${index}`,
      row: cell.row,
      column: cell.column,
      rowSpan: cell.rowSpan,
      colSpan: 1,
      text: cell.text,
      evidence: { page: 0, quoteHash: `slash-range-${index}` },
    }));
    const table: DocumentIrTable = {
      id: 'slash-range-grade-matrix', page: 0, rows: 9, columns: 7, cells,
    };

    const result = parseDurationGradeRangePriceMatrix(table, 2026);

    expect(result.map(calendar => calendar.gradeLabel)).toEqual(['세이브', '스탠다드', '프리미엄', '크라운']);
    const save = result.find(calendar => calendar.gradeLabel === '세이브');
    expect(save?.prices).toHaveLength(12);
    expect(save?.prices.find(price => price.date === '2026-09-05')?.amount).toBe(649_000);
    expect(result.find(calendar => calendar.gradeLabel === '크라운')?.prices
      .find(price => price.date === '2026-09-05')?.amount).toBe(1_419_000);
  });

  it('applies a row-spanned 제외일자 price over the wider weekday range', () => {
    const values = [
      { row: 3, column: 0, rowSpan: 1, text: '출발일' },
      { row: 3, column: 4, rowSpan: 1, text: '세이브' },
      { row: 3, column: 6, rowSpan: 1, text: '스탠다드' },
      { row: 3, column: 7, rowSpan: 1, text: '프리미엄' },
      { row: 3, column: 8, rowSpan: 1, text: '크라운' },
      { row: 4, column: 0, rowSpan: 6, text: '9/1\n~\n9/28' },
      { row: 4, column: 2, rowSpan: 3, text: '3박 4일' },
      { row: 4, column: 3, rowSpan: 1, text: '월' },
      { row: 4, column: 4, rowSpan: 1, text: '469,000' },
      { row: 4, column: 6, rowSpan: 1, text: '789,000' },
      { row: 4, column: 7, rowSpan: 1, text: '909,000' },
      { row: 4, column: 8, rowSpan: 1, text: '1,239,000' },
      { row: 5, column: 3, rowSpan: 1, text: '토' },
      { row: 5, column: 4, rowSpan: 1, text: '539,000' },
      { row: 5, column: 6, rowSpan: 1, text: '839,000' },
      { row: 5, column: 7, rowSpan: 1, text: '979,000' },
      { row: 5, column: 8, rowSpan: 1, text: '1,299,000' },
      { row: 6, column: 3, rowSpan: 1, text: '일' },
      { row: 6, column: 4, rowSpan: 1, text: '499,000' },
      { row: 6, column: 6, rowSpan: 1, text: '819,000' },
      { row: 6, column: 7, rowSpan: 1, text: '939,000' },
      { row: 6, column: 8, rowSpan: 1, text: '1,269,000' },
      { row: 10, column: 0, rowSpan: 4, text: '제\n외\n일\n자' },
      { row: 10, column: 1, rowSpan: 1, text: '9/5, 12' },
      { row: 10, column: 3, rowSpan: 4, text: '3박\n4일' },
      { row: 10, column: 4, rowSpan: 1, text: '649,000' },
      { row: 10, column: 6, rowSpan: 1, text: '969,000' },
      { row: 10, column: 7, rowSpan: 1, text: '1,109,000' },
      { row: 10, column: 8, rowSpan: 1, text: '1,419,000' },
    ];
    const cells = values.map((cell, index) => ({
      id: `excluded-date-cell-${index}`,
      nodeId: `excluded-date-node-${index}`,
      row: cell.row,
      column: cell.column,
      rowSpan: cell.rowSpan,
      colSpan: 1,
      text: cell.text,
      evidence: { page: 0, quoteHash: `excluded-date-${index}` },
    }));
    const table: DocumentIrTable = {
      id: 'excluded-date-grade-matrix', page: 0, rows: 14, columns: 9, cells,
    };

    const result = parseDurationGradeRangePriceMatrix(table, 2026);
    const save = result.find(calendar => calendar.durationDays === 4 && calendar.gradeLabel === '세이브');

    expect(save?.prices.find(price => price.date === '2026-09-05')?.amount).toBe(649_000);
    expect(save?.prices.find(price => price.date === '2026-09-12')?.amount).toBe(649_000);
  });

  it('maps adjacent day-roster and price pairs under row-spanning month cells', () => {
    const rows = [
      ['', '\uBD80\uC0B0-\uD6C4\uCFE0\uC624\uCE74 \uC815\uC11D\uD328\uD0A4\uC9C0 2\uBC153\uC77C'],
      ['\uC0C1\uD488', '5\uC6D4', '23 \uD1A0', '1,029,000', '24 \uC77C', '969,000'],
      ['', '', '25, 26, 27 \uC6D4-\uC218', '519,000', '28 \uBAA9', '719,000'],
      ['', '6\uC6D4', '1, 2 \uC6D4,\uD654', '699,000', '3 \uC218', '649,000'],
      ['', '', '18\uC77C \uC774\uD6C4', '', '', '\uBCC4\uB3C4\uBB38\uC758'],
      ['', '8\uC6D4', '10 \uC6D4', '799,000', '11 \uD654', '749,000'],
      ['', '9\uC6D4', '3(\uB9C8\uAC10), 10(\uB9C8\uAC10), 17, 24', '1,249,000', '\u2605\uD2B9\uAC00\u2605 15', '1,249,000 -->1,099,000'],
    ];
    const cells = rows.flatMap((values, row) => values.flatMap((text, column) => text ? [{
      id: `paired-cell-${row}-${column}`,
      nodeId: `paired-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text,
      evidence: { page: 0, quoteHash: `paired-${row}-${column}` },
    }] : []));
    const text = `26\uB144 5\uC6D4-6\uC6D4 2\uBC153\uC77C\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'paired-month-price.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'paired-month-price', page: 0, rows: rows.length, columns: 6, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result).toHaveLength(1);
    expect(result[0]?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-05-23', amount: 1_029_000 }),
      expect.objectContaining({ date: '2026-05-27', amount: 519_000 }),
      expect.objectContaining({ date: '2026-05-28', amount: 719_000 }),
      expect.objectContaining({ date: '2026-06-01', amount: 699_000 }),
      expect.objectContaining({ date: '2026-06-03', amount: 649_000 }),
      expect.objectContaining({ date: '2026-08-10', amount: 799_000 }),
      expect.objectContaining({ date: '2026-08-11', amount: 749_000 }),
      expect.objectContaining({ date: '2026-09-15', amount: 1_099_000 }),
      expect.objectContaining({ date: '2026-09-17', amount: 1_249_000 }),
      expect.objectContaining({ date: '2026-09-24', amount: 1_249_000 }),
    ]));
    expect(result[0]?.prices.some(price => price.date === '2026-06-18')).toBe(false);
    expect(result[0]?.prices.some(price => price.date === '2026-09-03')).toBe(false);
    expect(result[0]?.prices.some(price => price.date === '2026-09-10')).toBe(false);
    expect(result[0]?.prices[0]?.evidence.extraction_method).toBe('document_ir_table_cell');
  });

  it('keeps row-spanned monthly rosters separated by product duration', () => {
    const values = [
      { row: 0, column: 0, rowSpan: 1, text: '여행기간' },
      { row: 0, column: 1, rowSpan: 1, text: '출발일' },
      { row: 0, column: 3, rowSpan: 1, text: '상품가' },
      { row: 1, column: 0, rowSpan: 2, text: '3박4일\n수/금요일' },
      { row: 1, column: 1, rowSpan: 2, text: '8월' },
      { row: 1, column: 2, rowSpan: 1, text: '19, 21일' },
      { row: 1, column: 3, rowSpan: 1, text: '1,286,000원' },
      { row: 2, column: 2, rowSpan: 1, text: '26, 28일' },
      { row: 2, column: 3, rowSpan: 1, text: '1,336,000원' },
      { row: 3, column: 0, rowSpan: 2, text: '4박5일\n월/토요일' },
      { row: 3, column: 1, rowSpan: 2, text: '8월' },
      { row: 3, column: 2, rowSpan: 1, text: '3, 10일' },
      { row: 3, column: 3, rowSpan: 1, text: '1,336,000원' },
      { row: 4, column: 2, rowSpan: 1, text: '15일' },
      { row: 4, column: 3, rowSpan: 1, text: '1,436,000원' },
    ];
    const cells = values.map((cell, index) => ({
      id: `duration-month-cell-${index}`,
      nodeId: `duration-month-node-${index}`,
      row: cell.row,
      column: cell.column,
      rowSpan: cell.rowSpan,
      colSpan: 1,
      text: cell.text,
      evidence: { page: 0, quoteHash: `duration-month-${index}` },
    }));
    const text = `2026년 출발일별 요금 안내\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'duration-month-grid.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'duration-month-grid', page: 0, rows: 5, columns: 4, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result).toHaveLength(2);
    expect(result.map(calendar => [
      calendar.durationDays,
      calendar.productLabelKind,
      calendar.prices.map(price => [price.date, price.amount]),
    ])).toEqual([
      [4, 'duration', [
        ['2026-08-19', 1_286_000],
        ['2026-08-21', 1_286_000],
        ['2026-08-26', 1_336_000],
        ['2026-08-28', 1_336_000],
      ]],
      [5, 'duration', [
        ['2026-08-03', 1_336_000],
        ['2026-08-10', 1_336_000],
        ['2026-08-15', 1_436_000],
      ]],
    ]);
  });

  it('separates row-spanned duration and package-grade axes with dated overrides', () => {
    const values = [
      { row: 0, column: 0, rowSpan: 1, colSpan: 3, text: '출 발 일' },
      { row: 0, column: 3, rowSpan: 1, colSpan: 1, text: '실 속' },
      { row: 0, column: 4, rowSpan: 1, colSpan: 1, text: '품격(노팁+노옵션)' },
      { row: 1, column: 0, rowSpan: 1, colSpan: 1, text: '9/1-13' },
      { row: 1, column: 1, rowSpan: 1, colSpan: 1, text: '9/5 (토)' },
      { row: 1, column: 2, rowSpan: 1, colSpan: 1, text: '2박3일\n(북파)' },
      { row: 1, column: 3, rowSpan: 1, colSpan: 1, text: '799,000' },
      { row: 1, column: 4, rowSpan: 1, colSpan: 1, text: '999,000' },
      { row: 2, column: 0, rowSpan: 2, colSpan: 1, text: '9/1-13' },
      { row: 2, column: 1, rowSpan: 1, colSpan: 1, text: '월' },
      { row: 2, column: 2, rowSpan: 2, colSpan: 1, text: '3박4일\n(서북파)' },
      { row: 2, column: 3, rowSpan: 1, colSpan: 1, text: '700,000' },
      { row: 2, column: 4, rowSpan: 1, colSpan: 1, text: '900,000' },
      { row: 3, column: 1, rowSpan: 1, colSpan: 1, text: '수' },
      { row: 3, column: 3, rowSpan: 1, colSpan: 1, text: '800,000' },
      { row: 3, column: 4, rowSpan: 1, colSpan: 1, text: '1,000,000' },
      { row: 4, column: 0, rowSpan: 1, colSpan: 1, text: '제외 일자' },
      { row: 4, column: 1, rowSpan: 1, colSpan: 1, text: '9/9 (수)' },
      { row: 4, column: 2, rowSpan: 1, colSpan: 1, text: '3박4일\n(서북파)' },
      { row: 4, column: 3, rowSpan: 1, colSpan: 1, text: '850,000' },
      { row: 4, column: 4, rowSpan: 1, colSpan: 1, text: '1,050,000' },
    ];
    const cells = values.map((cell, index) => ({
      id: `duration-grade-cell-${index}`,
      nodeId: `duration-grade-node-${index}`,
      row: cell.row,
      column: cell.column,
      rowSpan: cell.rowSpan,
      colSpan: cell.colSpan,
      text: cell.text,
      evidence: { page: 0, quoteHash: `duration-grade-${index}` },
    }));
    const text = `2026년 연길 실속/품격 출발일 가격표\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'duration-grade-price.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'duration-grade-price', page: 0, rows: 5, columns: 5, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result.map(calendar => [
      calendar.durationDays,
      calendar.gradeLabel,
      calendar.productLabelKind,
      calendar.prices.map(price => [price.date, price.amount]),
    ])).toEqual([
      [3, '실속', 'package_grade', [['2026-09-05', 799_000]]],
      [3, '품격', 'package_grade', [['2026-09-05', 999_000]]],
      [4, '실속', 'package_grade', [
        ['2026-09-02', 800_000],
        ['2026-09-07', 700_000],
        ['2026-09-09', 850_000],
      ]],
      [4, '품격', 'package_grade', [
        ['2026-09-02', 1_000_000],
        ['2026-09-07', 900_000],
        ['2026-09-09', 1_050_000],
      ]],
    ]);
  });

  it('recovers monthly grade rosters when the HWP departure header is empty and status text is attached to dates', () => {
    const values = [
      { row: 3, column: 0, rowSpan: 1, colSpan: 3, text: '3박5일 [수]' },
      { row: 3, column: 3, rowSpan: 1, colSpan: 1, text: '실 속' },
      { row: 3, column: 4, rowSpan: 1, colSpan: 2, text: '화산·품격(노노노)' },
      { row: 4, column: 0, rowSpan: 1, colSpan: 1, text: '7월' },
      { row: 4, column: 1, rowSpan: 1, colSpan: 2, text: '8, 15일\n22, 29품격확정일' },
      { row: 4, column: 3, rowSpan: 1, colSpan: 1, text: '699,000' },
      { row: 4, column: 4, rowSpan: 1, colSpan: 2, text: '1,199,000' },
      { row: 5, column: 0, rowSpan: 2, colSpan: 1, text: '8월' },
      { row: 5, column: 1, rowSpan: 1, colSpan: 2, text: '5, 12일\n19품격확정일' },
      { row: 5, column: 3, rowSpan: 1, colSpan: 1, text: '469,000' },
      { row: 5, column: 4, rowSpan: 1, colSpan: 2, text: '999,000' },
      { row: 6, column: 1, rowSpan: 1, colSpan: 2, text: '26품격확정일' },
      { row: 6, column: 3, rowSpan: 1, colSpan: 1, text: '469,000' },
      { row: 6, column: 4, rowSpan: 1, colSpan: 2, text: '1,069,000' },
      { row: 7, column: 0, rowSpan: 1, colSpan: 6, text: '▶ 화산·품격 : 노팁, 노옵션, 노쇼핑 / 7월 30일까지 항공권 발권 조건입니다.' },
    ];
    const cells = values.map((cell, index) => ({
      id: `annotated-grade-cell-${index}`,
      nodeId: `annotated-grade-node-${index}`,
      row: cell.row,
      column: cell.column,
      rowSpan: cell.rowSpan,
      colSpan: cell.colSpan,
      text: cell.text,
      evidence: { page: 0, quoteHash: `annotated-grade-${index}` },
    }));
    const text = `37년에 걸쳐 만들어진 역사 유적 안내\n서안 실속/품격 가격표\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: '1) 26년 서안 PKG.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'annotated-grade-price', page: 0, rows: 8, columns: 6, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result.map(calendar => [calendar.durationDays, calendar.gradeLabel, calendar.prices.map(price => [price.date, price.amount])]))
      .toEqual([
        [5, '실속', [
          ['2026-07-08', 699_000], ['2026-07-15', 699_000], ['2026-07-22', 699_000], ['2026-07-29', 699_000],
          ['2026-08-05', 469_000], ['2026-08-12', 469_000], ['2026-08-19', 469_000], ['2026-08-26', 469_000],
        ]],
        [5, '품격', [
          ['2026-07-08', 1_199_000], ['2026-07-15', 1_199_000], ['2026-07-22', 1_199_000], ['2026-07-29', 1_199_000],
          ['2026-08-05', 999_000], ['2026-08-12', 999_000], ['2026-08-19', 999_000], ['2026-08-26', 1_069_000],
        ]],
      ]);
  });

  it('expands compact weekday groups and month-relative exception rosters per grade', () => {
    const values = [
      { row: 0, column: 0, rowSpan: 1, text: '패턴' },
      { row: 0, column: 1, rowSpan: 1, text: '출발일' },
      { row: 0, column: 3, rowSpan: 1, text: '라이트PKG' },
      { row: 0, column: 4, rowSpan: 1, text: '품격PKG' },
      { row: 1, column: 0, rowSpan: 2, text: '5일' },
      { row: 1, column: 1, rowSpan: 2, text: '9/13-21\n9/26-29' },
      { row: 1, column: 2, rowSpan: 1, text: '월화수목금' },
      { row: 1, column: 3, rowSpan: 1, text: '599,900원' },
      { row: 1, column: 4, rowSpan: 1, text: '679,900원' },
      { row: 2, column: 2, rowSpan: 1, text: '토일' },
      { row: 2, column: 3, rowSpan: 1, text: '559,900원' },
      { row: 2, column: 4, rowSpan: 1, text: '639,900원' },
      { row: 3, column: 0, rowSpan: 1, text: '5일' },
      { row: 3, column: 1, rowSpan: 1, text: '7/23,24,\n26-28' },
      { row: 3, column: 2, rowSpan: 1, text: '-' },
      { row: 3, column: 3, rowSpan: 1, text: '849,900원' },
      { row: 3, column: 4, rowSpan: 1, text: '929,900원' },
    ];
    const cells = values.map((cell, index) => ({
      id: `compact-grade-cell-${index}`,
      nodeId: `compact-grade-node-${index}`,
      row: cell.row,
      column: cell.column,
      rowSpan: cell.rowSpan,
      colSpan: 1,
      text: cell.text,
      evidence: { page: 0, quoteHash: `compact-grade-${index}` },
    }));
    const text = `2026년 7월~9월 라이트/품격 5일\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'compact-grade.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'compact-grade', page: 0, rows: 4, columns: 5, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });
    const light = result.find(calendar => calendar.gradeLabel === '라이트');
    const premium = result.find(calendar => calendar.gradeLabel === '품격');

    expect(result).toHaveLength(2);
    expect(light?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-09-13', amount: 559_900 }),
      expect.objectContaining({ date: '2026-09-14', amount: 599_900 }),
      expect.objectContaining({ date: '2026-07-23', amount: 849_900 }),
      expect.objectContaining({ date: '2026-07-28', amount: 849_900 }),
    ]));
    expect(premium?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-09-13', amount: 639_900 }),
      expect.objectContaining({ date: '2026-09-14', amount: 679_900 }),
      expect.objectContaining({ date: '2026-07-28', amount: 929_900 }),
    ]));
  });

  it('treats concise PKG cells beside 출발일 as independent package axes and carries merged dates', () => {
    const rows = [
      ['7월 8일 ~ 8월 26일 수(4박5일), 일(3박4일)', '', '부산-호화호특 BX3455 08:30-10:55'],
      ['출발일', '요일', '호화호특 노노 PKG', '호화호특 노노노 PKG', '호화호특 고품경 노노노 PKG'],
      ['7월 12일, 8월 23일', '3박4일 (일)', '999,000', '1,149,000', '1,299,000'],
      ['7월 19일', '', '1,049,000', '1,199,000', '1,349,000'],
      ['7월 8일, 8월 26일', '4박5일 (수)', '1,049,000', '1,199,000', '1,459,000'],
    ];
    const cells = rows.flatMap((values, row) => values.flatMap((text, column) => text ? [{
      id: `pkg-axis-${row}-${column}`,
      nodeId: `pkg-axis-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text,
      evidence: { page: 0, quoteHash: `pkg-axis-${row}-${column}` },
    }] : []));
    const text = `2026년 부산 내몽고 3박4일 4박5일 PKG\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'compact-pkg-axis.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'compact-pkg-axis', page: 0, rows: rows.length, columns: 5, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text, fallbackYear: 2026 });
    expect(result.map(calendar => [calendar.durationDays, calendar.gradeLabel])).toEqual(expect.arrayContaining([
      [4, '호화호특 노노 PKG'],
      [4, '호화호특 노노노 PKG'],
      [4, '호화호특 고품경 노노노 PKG'],
      [5, '호화호특 노노 PKG'],
      [5, '호화호특 노노노 PKG'],
      [5, '호화호특 고품경 노노노 PKG'],
    ]));
    expect(result).toHaveLength(6);
    expect(result.find(calendar => calendar.durationDays === 4 && calendar.gradeLabel === '호화호특 노노 PKG')?.prices)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ date: '2026-07-12', amount: 999_000 }),
        expect.objectContaining({ date: '2026-07-19', amount: 1_049_000 }),
      ]));
    expect(result.find(calendar => calendar.durationDays === 4 && calendar.gradeLabel === '호화호특 노노 PKG')?.prices).toHaveLength(3);
    expect(result.find(calendar => calendar.durationDays === 5 && calendar.gradeLabel === '호화호특 노노 PKG')?.prices).toHaveLength(2);
  });

  it('does not create phantom shorthand days from a mixed full-date list', () => {
    const rows = [
      ['패턴', '출 발 일 자', '상품가'],
      ['5일', '5/23, 5/30, 6/2', '749,000원'],
    ];
    const cells = rows.flatMap((values, row) => values.map((text, column) => ({
      id: `mixed-list-cell-${row}-${column}`,
      nodeId: `mixed-list-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text,
      evidence: { page: 0, quoteHash: `mixed-list-${row}-${column}` },
    })));
    const text = ['2026년 출발', ...cells.map(cell => cell.text)].join('\n');
    const ir: DocumentIR = {
      version: 'v4',
      sourceType: 'hwp',
      filename: 'mixed-date-list.hwp',
      text,
      pages: 1,
      parser: { engine: 'test', version: '1' },
      nodes: [],
      tables: [{ id: 'mixed-date-list', page: 0, rows: rows.length, columns: 3, cells }],
      assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: ir.text });

    expect(result[0]?.prices.map(price => price.date)).toEqual(['2026-05-23', '2026-05-30', '2026-06-02']);
    expect(result[0]?.prices.map(price => price.date)).not.toContain('2026-05-05');
  });

  it('does not mistake a numbered itinerary day in exclusions for the product duration', () => {
    const rows = [
      ['출발일& 상품가', '', '★출발확정★8/19(수), 8/23(일)', '', '', '999,000원'],
      ['', '', '★출발임박★9/3(목), 9/10(목)', '', '', '999,000원'],
      ['불포함사항', '', '유류세 166,000원, 2일차 석식 1회', '', '', ''],
    ];
    const cells = rows.flatMap((values, row) => values.flatMap((text, column) => text ? [{
      id: `spot-cell-${row}-${column}`,
      nodeId: `spot-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text,
      evidence: { page: 0, quoteHash: `spot-${row}-${column}` },
    }] : []));
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: '0819-0823.hwp',
      text: cells.map(cell => cell.text).join('\n'), pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'spot-price', page: 0, rows: rows.length, columns: 6, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({
      documentIr: ir,
      sectionRawText: `북해도 스팟특가 3박4일\n${ir.text}`,
      fallbackYear: 2026,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.durationDays).toBe(4);
    expect(result[0]?.prices.map(price => [price.date, price.amount])).toEqual([
      ['2026-08-19', 999_000],
      ['2026-08-23', 999_000],
      ['2026-09-03', 999_000],
      ['2026-09-10', 999_000],
    ]);
  });

  it('maps a supplier monthly calendar grid by validated weekday columns', () => {
    const rows = [
      ['2026년 9월 SEPTEMBER', '', '', '', '', '', ''],
      ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'],
      ['', '', '1', '2', '3', '4', '5'],
      ['', '', '299,000', '309,000', 'X', '399,000', '419,000'],
      ['6', '7', '8', '9', '10', '11', '12'],
      ['279,000', '289,000', '299,000', '309,000', '319,000', '399,000', '429,000'],
    ];
    const cells = rows.flatMap((values, row) => values.map((text, column) => ({
      id: `calendar-cell-${row}-${column}`,
      nodeId: `calendar-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text,
      evidence: { page: 0, quoteHash: `calendar-${row}-${column}` },
    })));
    const text = ['후쿠오카 시내숙박 2박3일', ...cells.map(cell => cell.text)].join('\n');
    const ir: DocumentIR = {
      version: 'v4',
      sourceType: 'hwp',
      filename: '후쿠오카 2026년 9월.hwp',
      text,
      pages: 1,
      parser: { engine: 'test', version: '1' },
      nodes: [],
      tables: [{ id: 'daily-calendar', page: 0, rows: rows.length, columns: 7, cells }],
      assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: ir.text });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ durationDays: 3, gradeLabel: null }));
    expect(result[0]?.prices.map(price => [price.date, price.amount])).toEqual([
      ['2026-09-01', 299_000],
      ['2026-09-02', 309_000],
      ['2026-09-04', 399_000],
      ['2026-09-05', 419_000],
      ['2026-09-06', 279_000],
      ['2026-09-07', 289_000],
      ['2026-09-08', 299_000],
      ['2026-09-09', 309_000],
      ['2026-09-10', 319_000],
      ['2026-09-11', 399_000],
      ['2026-09-12', 429_000],
    ]);
    expect(result[0]?.prices[0]?.evidence).toEqual(expect.objectContaining({
      table_id: 'daily-calendar',
      node_id: 'calendar-node-3-2',
      quote: '1\n299,000',
    }));
  });

  it('links a labeled departure row to a separate labeled travel-cost row in the same table', () => {
    const rows = [
      ['[노옵션/노팁/노쇼핑] 황산 5일 PKG', '', '', ''],
      ['출 발 일 자', '', '26년 4월 17일 (금)', ''],
      ['여 행 경 비', '', '￦1,379,000/인', ''],
      ['불포함 사항', '', '싱글차지 $195/인', ''],
    ];
    const cells = rows.flatMap((values, row) => values.flatMap((text, column) => text ? [{
      id: `scalar-cell-${row}-${column}`,
      nodeId: `scalar-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: column === 2 ? 2 : 1,
      text,
      evidence: { page: 0, quoteHash: `scalar-${row}-${column}` },
    }] : []));
    const text = cells.map(cell => cell.text).join('\n');
    const ir: DocumentIR = {
      version: 'v4',
      sourceType: 'hwp',
      filename: '260417-huangshan.hwp',
      text,
      pages: 1,
      parser: { engine: 'test', version: '1' },
      nodes: [],
      tables: [{ id: 'scalar-price-table', page: 0, rows: rows.length, columns: 4, cells }],
      assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: ir.text });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ durationDays: 5, gradeLabel: null }));
    expect(result[0]?.prices).toEqual([expect.objectContaining({
      date: '2026-04-17',
      amount: 1_379_000,
      currency: 'KRW',
    })]);
    expect(result[0]?.prices[0]?.evidence).toEqual(expect.objectContaining({
      table_id: 'scalar-price-table',
      node_id: 'scalar-node-2-2',
    }));
  });

  it('uses only the first day of a duration-matched travel period and keeps the final arrow price', () => {
    const rows = [
      ['여행기간', '5월 14일(목) – 5월 18일(월) ★노팁+노옵션★'],
      ['상품가', '￦699,000원 => 579,000/인 [성인/아동 동일]'],
      ['포함 사항', '왕복 항공료, 호텔, 식사'],
    ];
    const cells = rows.flatMap((values, row) => values.map((text, column) => ({
      id: `period-cell-${row}-${column}`,
      nodeId: `period-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text,
      evidence: { page: 0, quoteHash: `period-${row}-${column}` },
    })));
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: '나트랑 5월 상품.hwp',
      text: cells.map(cell => cell.text).join('\n'), pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'travel-period-price', page: 0, rows: rows.length, columns: 2, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({
      documentIr: ir,
      sectionRawText: `나트랑 3박5일\n${ir.text}`,
      fallbackYear: 2026,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ durationDays: 5 }));
    expect(result[0]?.prices).toEqual([expect.objectContaining({
      date: '2026-05-14',
      amount: 579_000,
      list_price: 699_000,
      price_relation: 'final_sale',
    })]);
  });

  it('keeps separate duration products and binds each travel-cost row to its sibling date roster', () => {
    const makeTable = (id: string, title: string, rows: string[][]) => {
      const values = [[title, '', '', '', '', '', ''], ...rows];
      return {
        id,
        page: 0,
        rows: values.length,
        columns: 7,
        cells: values.flatMap((columns, row) => columns.flatMap((text, column) => text ? [{
          id: `${id}-cell-${row}-${column}`,
          nodeId: `${id}-node-${row}-${column}`,
          row,
          column,
          rowSpan: 1,
          colSpan: 1,
          text,
          evidence: { page: 0, quoteHash: `${id}-${row}-${column}` },
        }] : [])),
      };
    };
    const tables = [
      makeTable('huangshan-4d', '[노옵션/노팁] 황산+서체 4일 PKG', [
        ['출 발 일 자', '', '26년 4월 10일 ~ 5월 29일 (화)', '', '', '', ''],
        ['여 행 경 비', '', '4월 14,21,28일\n5월 5,12,19,26일', '', '', '', '849,000/인'],
        ['포 함 사 항', '', '왕복항공료, 호텔, 차량, 식사', '', '', '', ''],
        ['비 고', '', '2024년 11월부터 2026년 12월까지 중국 무비자 입국 안내', '', '', '', ''],
      ]),
      makeTable('huangshan-5d', '[노옵션/노팁] 황산+삼청산+서체 5일 PKG', [
        ['출 발 일 자', '', '26년 4월 11일 ~ 5월 26일 (금)', '', '', '', ''],
        ['여 행 경 비', '', '4월 10,17,24일\n5월 8,15,29일', '', '', '', '949,000/인'],
        ['', '', '5월 1일', '', '', '', '1,199,000/인'],
        ['', '', '5월 22일', '', '', '', '1,049,000/인'],
        ['포 함 사 항', '', '왕복항공료, 호텔, 차량, 식사', '', '', '', ''],
      ]),
    ];
    const text = tables.flatMap(table => table.cells.map(cell => cell.text)).join('\n');
    const ir: DocumentIR = {
      version: 'v4',
      sourceType: 'hwp',
      filename: '2026-huangshan-4d-5d.hwp',
      text,
      pages: 1,
      parser: { engine: 'test', version: '1' },
      nodes: [],
      tables,
      assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result).toHaveLength(2);
    expect(result.find(item => item.durationDays === 4)?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-04-14', amount: 849_000 }),
      expect.objectContaining({ date: '2026-05-26', amount: 849_000 }),
    ]));
    expect(result.find(item => item.durationDays === 4)?.prices).toHaveLength(7);
    expect(result.find(item => item.durationDays === 5)?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-04-10', amount: 949_000 }),
      expect.objectContaining({ date: '2026-05-01', amount: 1_199_000 }),
      expect.objectContaining({ date: '2026-05-22', amount: 1_049_000 }),
      expect.objectContaining({ date: '2026-05-29', amount: 949_000 }),
    ]));
    expect(result.find(item => item.durationDays === 5)?.prices).toHaveLength(8);
    expect(result.every(item => item.prices.every(price => price.evidence.extraction_method === 'document_ir_table_cell'))).toBe(true);
  });

  it('binds a scalar sale price when the commercial label, departure dates, and amount use separate cells', () => {
    const rows = [
      ['【에어부산】 울란바토르,테를지 3박5일', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', ''],
      ['출발날짜', '', '', '5월 5일', '', '', '상품가', '629,000', ''],
      ['포 함 내 역', '', '', '항공료 및 텍스, 유류할증료, 숙박', '', '', '', '', ''],
    ];
    const cells = rows.flatMap((values, row) => values.flatMap((text, column) => text ? [{
      id: `scalar-separated-${row}-${column}`,
      nodeId: `scalar-separated-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text,
      evidence: { page: 0, quoteHash: `scalar-separated-${row}-${column}` },
    }] : []));
    const text = cells.map(cell => cell.text).join('\n');
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'scalar-separated.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'scalar-separated', page: 0, rows: rows.length, columns: 9, cells }], assets: [],
    };

    const candidates = buildDocumentIrTablePriceCalendarCandidates({
      table: ir.tables[0]!,
      sectionRawText: text,
      fallbackYear: 2026,
    });
    const result = buildDocumentIrTablePriceCalendars({
      documentIr: ir,
      sectionRawText: text,
      fallbackYear: 2026,
      fallbackDurationDays: 4,
    });

    expect(candidates).toEqual(result);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      durationDays: 5,
      prices: [{ date: '2026-05-05', amount: 629_000 }],
    });
  });

  it('reads compact departure-confirmed rows without inventing a formal price header', () => {
    const rows = [
      ['출발 / 확정', ''],
      ['4/12(일) 1,099,000원', ''],
      ['4/19(일) 1,149,000원', ''],
      ['4/15(수) 마감', ''],
    ];
    const cells = rows.flatMap((values, row) => values.flatMap((text, column) => text ? [{
      id: `compact-confirmed-${row}-${column}`,
      nodeId: `compact-confirmed-node-${row}-${column}`,
      row, column, rowSpan: 1, colSpan: 1, text,
      evidence: { page: 0, quoteHash: `compact-confirmed-${row}-${column}` },
    }] : []));
    const text = `2026년 장가계 노노노 3박4일\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'compact-confirmed.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'compact-confirmed', page: 0, rows: rows.length, columns: 2, cells }], assets: [],
    };
    const result = buildDocumentIrTablePriceCalendars({
      documentIr: ir,
      sectionRawText: text,
      fallbackYear: 2026,
      fallbackDurationDays: 4,
    });
    expect(result[0]?.prices.map(price => [price.date, price.amount])).toEqual([
      ['2026-04-12', 1_099_000],
      ['2026-04-19', 1_149_000],
    ]);
  });

  it('binds a weekday commercial price to a Korean month roster with repeated day suffixes', () => {
    const rows = [
      ['청주-석가장 태항산 4일', '', ''],
      ['상 품 가 / 노팁 / 노옵션 / 노쇼핑', '< 매주 수요일 출발 >', '최소출발인원 10명'],
      ['', '04월 1일, 8일, 15일, 22일, 29일', '￦899,000 /인'],
      ['포함 내역', '항공료, 호텔', ''],
    ];
    const cells = rows.flatMap((values, row) => values.flatMap((text, column) => text ? [{
      id: `weekday-roster-${row}-${column}`,
      nodeId: `weekday-roster-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text,
      evidence: { page: 0, quoteHash: `weekday-roster-${row}-${column}` },
    }] : []));
    const text = cells.map(cell => cell.text).join('\n');
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: '26년 태항산 4일.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'weekday-commercial-roster', page: 0, rows: rows.length, columns: 3, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({
      documentIr: ir,
      sectionRawText: text,
      fallbackYear: 2026,
      fallbackDurationDays: 4,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.prices).toHaveLength(5);
    expect(result[0]?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-04-01', amount: 899_000 }),
      expect.objectContaining({ date: '2026-04-29', amount: 899_000 }),
    ]));
  });

  it('splits explicitly labeled hotel-grade prices into independent product calendars', () => {
    const rows = [
      ['푸꾸옥 3박 5일', '', ''],
      ['출 발 일 자', '', '26년 8월 1일'],
      ['판 매 가 격', '8/1 (목) 출발', '4성급 호텔: 1,059,000원\n5성급 호텔: 1,179,000원'],
    ];
    const cells = rows.flatMap((values, row) => values.flatMap((text, column) => text ? [{
      id: `multi-cell-${row}-${column}`,
      nodeId: `multi-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text,
      evidence: { page: 0, quoteHash: `multi-${row}-${column}` },
    }] : []));
    const text = cells.map(cell => cell.text).join('\n');
    const ir: DocumentIR = {
      version: 'v4',
      sourceType: 'hwp',
      filename: 'phu-quoc.hwp',
      text,
      pages: 1,
      parser: { engine: 'test', version: '1' },
      nodes: [],
      tables: [{ id: 'multi-price-table', page: 0, rows: rows.length, columns: 3, cells }],
      assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: ir.text });

    expect(result).toHaveLength(2);
    expect(result.map(item => [item.gradeLabel, item.productLabelKind, item.prices[0]?.date, item.prices[0]?.amount])).toEqual([
      ['4성급 호텔', 'lodging_grade', '2026-08-01', 1_059_000],
      ['5성급 호텔', 'lodging_grade', '2026-08-01', 1_179_000],
    ]);
  });

  it('keeps repeated date rows separated by explicitly labeled hotel grades', () => {
    const values = [
      { row: 0, column: 0, rowSpan: 1, colSpan: 5, text: '[노쇼핑노옵션노팁] 푸꾸옥 3박 5일' },
      { row: 1, column: 0, rowSpan: 1, colSpan: 1, text: '출 발 일 자' },
      { row: 1, column: 1, rowSpan: 1, colSpan: 3, text: '2026년 7/28, 30, 8/11, 13 출발' },
      { row: 2, column: 0, rowSpan: 2, colSpan: 1, text: '판 매 가 격' },
      { row: 2, column: 1, rowSpan: 1, colSpan: 1, text: '7/28, 8/11 (화) 출발' },
      { row: 2, column: 2, rowSpan: 1, colSpan: 2, text: '4성급 호텔: 1,459,000원/인\n5성급 호텔: 1,579,000원/인' },
      { row: 3, column: 1, rowSpan: 1, colSpan: 1, text: '7/30, 8/13 (목) 출발' },
      { row: 3, column: 2, rowSpan: 1, colSpan: 2, text: '4성급 호텔: 1,479,000원/인\n5성급 호텔: 1,599,000원/인' },
    ];
    const cells = values.map((cell, index) => ({
      id: `hotel-grade-row-${index}`,
      nodeId: `hotel-grade-row-${index}`,
      row: cell.row,
      column: cell.column,
      rowSpan: cell.rowSpan,
      colSpan: cell.colSpan,
      text: cell.text,
      evidence: { page: 0, quoteHash: `hotel-grade-row-${index}` },
    }));
    const text = cells.map(cell => cell.text).join('\n');
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'hotel-grade-rows.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'hotel-grade-rows', page: 0, rows: 4, columns: 5, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result.map(calendar => ({
      label: calendar.gradeLabel,
      kind: calendar.productLabelKind,
      prices: calendar.prices.map(price => [price.date, price.amount]),
    }))).toEqual([
      {
        label: '4성급 호텔',
        kind: 'lodging_grade',
        prices: [
          ['2026-07-28', 1_459_000],
          ['2026-07-30', 1_479_000],
          ['2026-08-11', 1_459_000],
          ['2026-08-13', 1_479_000],
        ],
      },
      {
        label: '5성급 호텔',
        kind: 'lodging_grade',
        prices: [
          ['2026-07-28', 1_579_000],
          ['2026-07-30', 1_599_000],
          ['2026-08-11', 1_579_000],
          ['2026-08-13', 1_599_000],
        ],
      },
    ]);
    expect(result.every(calendar => calendar.prices.every(price => (
      price.evidence.extraction_method === 'document_ir_table_cell'
    )))).toBe(true);
  });

  it('binds price to the duration and dates in the same row without inventing overlapping dates', () => {
    const rows = [
      ['349,000', '[3박5일] 5/20'],
      ['399,000', '[4박6일] 5/2, 5/3, 5/9'],
    ];
    const cells = rows.flatMap((values, row) => values.map((cellText, column) => ({
      id: `duration-cell-${row}-${column}`,
      nodeId: `duration-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text: cellText,
      evidence: { page: 0, quoteHash: `duration-${row}-${column}` },
    })));
    const text = `2027년 보홀 상품\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'bohol-duration.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'duration-price-table', page: 0, rows: rows.length, columns: 2, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result).toHaveLength(2);
    expect(result.find(item => item.durationDays === 5)?.prices.map(price => [price.date, price.amount])).toEqual([
      ['2027-05-20', 349_000],
    ]);
    expect(result.find(item => item.durationDays === 6)?.prices.map(price => [price.date, price.amount])).toEqual([
      ['2027-05-02', 399_000],
      ['2027-05-03', 399_000],
      ['2027-05-09', 399_000],
    ]);
  });

  it('keeps merged multi-duration product blocks independent', () => {
    const cells = [
      { id: 'header-product', nodeId: 'n-header-product', row: 0, column: 0, rowSpan: 1, colSpan: 1, text: '상품명' },
      { id: 'header-date', nodeId: 'n-header-date', row: 0, column: 1, rowSpan: 1, colSpan: 1, text: '출발일' },
      { id: 'header-price', nodeId: 'n-header-price', row: 0, column: 2, rowSpan: 1, colSpan: 1, text: '상품가' },
      { id: 'product-5', nodeId: 'n-product-5', row: 1, column: 0, rowSpan: 2, colSpan: 1, text: '초원여행 3박5일' },
      { id: 'date-5-a', nodeId: 'n-date-5-a', row: 1, column: 1, rowSpan: 1, colSpan: 1, text: '7/3일' },
      { id: 'price-5-a', nodeId: 'n-price-5-a', row: 1, column: 2, rowSpan: 1, colSpan: 1, text: '1,439,000' },
      { id: 'date-5-b', nodeId: 'n-date-5-b', row: 2, column: 1, rowSpan: 1, colSpan: 1, text: '7/10,24일' },
      { id: 'price-5-b', nodeId: 'n-price-5-b', row: 2, column: 2, rowSpan: 1, colSpan: 1, text: '1,379,000' },
      { id: 'product-6', nodeId: 'n-product-6', row: 3, column: 0, rowSpan: 2, colSpan: 1, text: '사막여행 4박6일' },
      { id: 'date-6-a', nodeId: 'n-date-6-a', row: 3, column: 1, rowSpan: 1, colSpan: 1, text: '7/6일' },
      { id: 'price-6-a', nodeId: 'n-price-6-a', row: 3, column: 2, rowSpan: 1, colSpan: 1, text: '1,399,000' },
      { id: 'date-6-b', nodeId: 'n-date-6-b', row: 4, column: 1, rowSpan: 1, colSpan: 1, text: '7/13일' },
      { id: 'price-6-b', nodeId: 'n-price-6-b', row: 4, column: 2, rowSpan: 1, colSpan: 1, text: '1,479,000' },
    ].map(cell => ({ ...cell, evidence: { page: 0, quoteHash: cell.id } }));
    const text = `2027년\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'multi-duration-blocks.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'multi-duration-blocks', page: 0, rows: 5, columns: 3, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result.map(calendar => [
      calendar.durationDays,
      calendar.productLabelKind,
      calendar.prices.map(price => [price.date, price.amount]),
    ])).toEqual([
      [5, 'duration', [['2027-07-03', 1_439_000], ['2027-07-10', 1_379_000], ['2027-07-24', 1_379_000]]],
      [6, 'duration', [['2027-07-06', 1_399_000], ['2027-07-13', 1_479_000]]],
    ]);
  });

  it('publishes only explicitly priced dates when a weekly operating range has no default price', () => {
    const rows = [
      ['【노쇼핑】 황산 송백CC 무제한 골프 4일 BX', '', ''],
      ['출 발 일', '4월10일부터 ~ 5월29일까지 매주 화 출발', ''],
      ['여 행 경 비', '5월-19,26일', '849,000'],
      ['', '5월05일', '999,000'],
    ];
    const cells = rows.flatMap((values, row) => values.flatMap((text, column) => text ? [{
      id: `weekly-cell-${row}-${column}`,
      nodeId: `weekly-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text,
      evidence: { page: 0, quoteHash: `weekly-${row}-${column}` },
    }] : []));
    const text = `2027년\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'songbaek.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'weekly-special-price', page: 0, rows: rows.length, columns: 3, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result).toHaveLength(1);
    expect(result[0]?.durationDays).toBe(4);
    expect(result[0]?.prices.map(price => [price.date, price.amount])).toEqual([
      ['2027-05-05', 999_000],
      ['2027-05-19', 849_000],
      ['2027-05-26', 849_000],
    ]);
    expect(result[0]?.prices.some(price => price.date_range)).toBe(false);
  });

  it('pairs each dated sale row even when the sale label spans the rows', () => {
    const cells = [
      { id: 'title', nodeId: 'n-title', row: 0, column: 0, rowSpan: 1, colSpan: 7, text: '푸꾸옥 3박5일' },
      { id: 'departure-label', nodeId: 'n-departure-label', row: 1, column: 0, rowSpan: 1, colSpan: 2, text: '출 발 일' },
      { id: 'departure-list', nodeId: 'n-departure-list', row: 1, column: 2, rowSpan: 1, colSpan: 5, text: '5/7, 5/15' },
      { id: 'sale-label', nodeId: 'n-sale-label', row: 2, column: 0, rowSpan: 2, colSpan: 2, text: '판매가' },
      { id: 'date-7', nodeId: 'n-date-7', row: 2, column: 2, rowSpan: 1, colSpan: 3, text: '5/7 출발' },
      { id: 'price-7', nodeId: 'n-price-7', row: 2, column: 5, rowSpan: 1, colSpan: 2, text: '특가 1인 799,000원 (3월 25일 발권 조건)' },
      { id: 'date-15', nodeId: 'n-date-15', row: 3, column: 2, rowSpan: 1, colSpan: 3, text: '5/15 출발' },
      { id: 'price-15', nodeId: 'n-price-15', row: 3, column: 5, rowSpan: 1, colSpan: 2, text: '특가 1인 749,000원 (3월 25일 발권 조건)' },
    ].map(cell => ({ ...cell, evidence: { page: 0, quoteHash: cell.id } }));
    const text = `2027년\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'dated-sale-rows.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'dated-sale-rows', page: 0, rows: 4, columns: 7, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result).toHaveLength(1);
    expect(result[0]?.prices.map(price => [price.date, price.amount])).toEqual([
      ['2027-05-07', 799_000],
      ['2027-05-15', 749_000],
    ]);
  });

  it('binds date lists and final discounted prices written together in one cell', () => {
    const cells = [
      { id: 'title', nodeId: 'n-title', row: 0, column: 0, rowSpan: 1, colSpan: 2, text: '다낭 3박5일' },
      { id: 'departure-label', nodeId: 'n-departure-label', row: 1, column: 0, rowSpan: 1, colSpan: 1, text: '출발일' },
      { id: 'sale-label', nodeId: 'n-sale-label', row: 1, column: 1, rowSpan: 1, colSpan: 1, text: '상품가' },
      { id: 'sale-a', nodeId: 'n-sale-a', row: 2, column: 0, rowSpan: 1, colSpan: 2, text: '9/6,13,20,28,29 出 - 1인당 519,000-> 399,000원' },
      { id: 'sale-b', nodeId: 'n-sale-b', row: 3, column: 0, rowSpan: 1, colSpan: 2, text: '9/16,17 出 - 1인당 559,000-> 479,000원' },
      { id: 'sale-c', nodeId: 'n-sale-c', row: 4, column: 0, rowSpan: 1, colSpan: 2, text: '9/30, 10/4,5,15 出 - 1인당 639,000-> 519,000원' },
      { id: 'sale-d', nodeId: 'n-sale-d', row: 5, column: 0, rowSpan: 1, colSpan: 2, text: '8/24,25,29 出 - 1인당 659,000-> 539,000원' },
    ].map(cell => ({ ...cell, evidence: { page: 0, quoteHash: cell.id } }));
    const text = `2026년\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'inline-date-sale-rows.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'inline-date-sale-rows', page: 0, rows: 6, columns: 2, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result).toHaveLength(1);
    expect(result[0]?.prices).toHaveLength(14);
    expect(result[0]?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-08-24', amount: 539_000, list_price: 659_000 }),
      expect.objectContaining({ date: '2026-09-06', amount: 399_000, list_price: 519_000 }),
      expect.objectContaining({ date: '2026-09-16', amount: 479_000, list_price: 559_000 }),
      expect.objectContaining({ date: '2026-10-15', amount: 519_000, list_price: 639_000 }),
    ]));
    expect(new Set(result[0]?.prices.map(price => `${price.date}:${price.amount}`)).size).toBe(14);
  });

  it('splits merged monthly hotel columns and derives days from the source night/day relation', () => {
    const cells = [
      { id: 'h-date', nodeId: 'hn-date', row: 0, column: 0, rowSpan: 1, colSpan: 4, text: '날짜' },
      { id: 'h-a', nodeId: 'hn-a', row: 0, column: 4, rowSpan: 1, colSpan: 2, text: '헤난 타왈라' },
      { id: 'h-b', nodeId: 'hn-b', row: 0, column: 6, rowSpan: 1, colSpan: 1, text: '헤난 알로나비치\n헤난 프리미어코스트' },
      { id: 'm7', nodeId: 'n-m7', row: 1, column: 0, rowSpan: 2, colSpan: 1, text: '7월' },
      { id: 'd19', nodeId: 'n-d19', row: 1, column: 2, rowSpan: 1, colSpan: 1, text: '19' },
      { id: 'n3', nodeId: 'n-n3', row: 1, column: 3, rowSpan: 2, colSpan: 1, text: '3박' },
      { id: 'a19', nodeId: 'n-a19', row: 1, column: 4, rowSpan: 1, colSpan: 2, text: '839,000 -> 599,000' },
      { id: 'b19', nodeId: 'n-b19', row: 1, column: 6, rowSpan: 1, colSpan: 1, text: '879,000 -> 659,000' },
      { id: 'd20', nodeId: 'n-d20', row: 2, column: 2, rowSpan: 1, colSpan: 1, text: '20' },
      { id: 'a20', nodeId: 'n-a20', row: 2, column: 4, rowSpan: 1, colSpan: 2, text: '609,000' },
      { id: 'b20', nodeId: 'n-b20', row: 2, column: 6, rowSpan: 1, colSpan: 1, text: '669,000' },
      { id: 'm8', nodeId: 'n-m8', row: 3, column: 0, rowSpan: 1, colSpan: 1, text: '8월' },
      { id: 'd2', nodeId: 'n-d2', row: 3, column: 2, rowSpan: 1, colSpan: 1, text: '2' },
      { id: 'n4', nodeId: 'n-n4', row: 3, column: 3, rowSpan: 1, colSpan: 1, text: '4박' },
      { id: 'a2', nodeId: 'n-a2', row: 3, column: 4, rowSpan: 1, colSpan: 2, text: '699,000' },
      { id: 'b2', nodeId: 'n-b2', row: 3, column: 6, rowSpan: 1, colSpan: 1, text: '759,000' },
    ].map(cell => ({ ...cell, evidence: { page: 0, quoteHash: cell.id } }));
    const text = `2026년 보홀 4박6일시\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'bohol-hotels.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'hotel-roster', page: 0, rows: 4, columns: 7, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result).toHaveLength(6);
    expect(result.find(item => item.durationDays === 5 && item.gradeLabel === '헤난 타왈라')?.prices).toEqual([
      expect.objectContaining({ date: '2026-07-19', amount: 599_000, list_price: 839_000 }),
      expect.objectContaining({ date: '2026-07-20', amount: 609_000 }),
    ]);
    expect(result.find(item => item.durationDays === 5 && item.gradeLabel === '헤난 프리미어코스트')?.prices[0]).toEqual(
      expect.objectContaining({ date: '2026-07-19', amount: 659_000 }),
    );
    expect(result.find(item => item.durationDays === 6 && item.gradeLabel === '헤난 알로나비치')?.prices[0]).toEqual(
      expect.objectContaining({ date: '2026-08-02', amount: 759_000 }),
    );
  });

  it('keeps duration, date range, weekdays and amount in the same table row', () => {
    const ir = documentIr();
    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: ir.text });
    expect(result.map(item => item.durationDays)).toEqual([5, 6]);
    expect(result[0]?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        date: null,
        date_range: { start: '2026-07-01', end: '2026-07-22' },
        weekday: 0,
        amount: 1_139_000,
        currency: 'KRW',
      }),
      expect.objectContaining({
        date_range: { start: '2026-07-23', end: '2026-08-03' },
        weekday: 5,
        amount: 1_229_000,
      }),
    ]));
    expect(result[1]?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ date_range: { start: '2026-10-01', end: '2026-10-24' }, weekday: 3, amount: 1_159_000 }),
      expect.objectContaining({ date: '2026-09-21', date_range: null, amount: 1_419_000 }),
    ]));
    expect(result[1]?.prices.some(item => item.date_range && item.weekday === 0)).toBe(false);
    expect(result.flatMap(item => item.prices).some(item => item.amount === 200_000)).toBe(false);
    expect(result.flatMap(item => item.prices).every(item => item.evidence.quote.includes('\uC6D0'))).toBe(true);
  });

  it('keeps grade columns separate even when supplier prices omit the won suffix', () => {
    const rows = [
      ['패턴', '출발일', '실속', '품격', '고품격'],
      ['5일', '10/10,17,24,31', '819,000', '1,359,000', '1,539,000'],
    ];
    const cells = rows.flatMap((values, row) => values.map((text, column) => ({
      id: `grade-cell-${row}-${column}`,
      nodeId: `grade-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text,
      evidence: { page: 0, quoteHash: `grade-${row}-${column}` },
    })));
    const text = `2026년 출발일 판매가\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4',
      sourceType: 'hwp',
      filename: 'grade-price.hwp',
      text,
      pages: 1,
      parser: { engine: 'test', version: '1' },
      nodes: [],
      tables: [{ id: 'grade-price-table', page: 0, rows: rows.length, columns: 5, cells }],
      assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: ir.text });

    expect(result.map(item => item.gradeLabel)).toEqual(['고품격', '실속', '품격']);
    expect(result.find(item => item.gradeLabel === '실속')?.prices).toHaveLength(4);
    expect(result.find(item => item.gradeLabel === '실속')?.prices[0]).toEqual(expect.objectContaining({
      date: '2026-10-10',
      amount: 819_000,
      currency: 'KRW',
    }));
    expect(result.find(item => item.gradeLabel === '고품격')?.prices[3]).toEqual(expect.objectContaining({
      date: '2026-10-31',
      amount: 1_539_000,
    }));
  });

  it('reads a carried month and exact day from a grade price matrix', () => {
    const rows = [
      ['부산-호화호특 4박5일 PKG', '', '', '', ''],
      ['출 발 일', '2026. 07. 08 ~ 08. 30', '', '', ''],
      ['월', '일', '품격(노팁,노옵션)', '', '고품격(노팁,노옵션,노쇼핑)'],
      ['7', '8', '1,049,000', '', '1,199,000'],
      ['', '15', '1,099,000', '', '1,249,000'],
      ['8', '5', '1,199,000', '', '1,599,000'],
    ];
    const cells = rows.flatMap((values, row) => values.map((text, column) => ({
      id: `matrix-cell-${row}-${column}`,
      nodeId: `matrix-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text,
      evidence: { page: 0, quoteHash: `matrix-${row}-${column}` },
    })));
    const text = cells.map(cell => cell.text).join('\n');
    const ir: DocumentIR = {
      version: 'v4',
      sourceType: 'hwp',
      filename: 'matrix-price.hwp',
      text,
      pages: 1,
      parser: { engine: 'test', version: '1' },
      nodes: [],
      tables: [{ id: 'matrix-price-table', page: 0, rows: rows.length, columns: 5, cells }],
      assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: ir.text });

    expect(result).toHaveLength(2);
    expect(result.find(item => item.gradeLabel === '품격')?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-07-08', amount: 1_049_000 }),
      expect.objectContaining({ date: '2026-07-15', amount: 1_099_000 }),
      expect.objectContaining({ date: '2026-08-05', amount: 1_199_000 }),
    ]));
    expect(result.find(item => item.gradeLabel === '고품격')?.prices[0]?.evidence.table_id).toBe('matrix-price-table');
  });

  it('merges non-overlapping exact-date tables for one duration', () => {
    const makeTable = (id: string, month: number, day: number, amount: string) => {
      const rows = [
        ['출발일 [3박 4일]', '상품가'],
        [`${month}/${day}`, amount],
      ];
      return {
        id,
        page: 0,
        rows: rows.length,
        columns: 2,
        cells: rows.flatMap((values, row) => values.map((text, column) => ({
          id: `${id}-${row}-${column}`,
          nodeId: `${id}-node-${row}-${column}`,
          row,
          column,
          rowSpan: 1,
          colSpan: 1,
          text,
          evidence: { page: 0, quoteHash: `${id}-${row}-${column}` },
        }))),
      };
    };
    const tables = [makeTable('may', 5, 3, '1,019,000'), makeTable('sep', 9, 14, '1,079,000')];
    const text = `2026년\n${tables.flatMap(table => table.cells.map(cell => cell.text)).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4',
      sourceType: 'hwp',
      filename: 'multi-table-price.hwp',
      text,
      pages: 1,
      parser: { engine: 'test', version: '1' },
      nodes: [],
      tables,
      assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: ir.text });

    expect(result).toHaveLength(1);
    expect(result[0]?.prices).toEqual([
      expect.objectContaining({ date: '2026-05-03', amount: 1_019_000 }),
      expect.objectContaining({ date: '2026-09-14', amount: 1_079_000 }),
    ]);
    expect(result[0]?.prices.map(price => price.evidence.table_id)).toEqual(['may', 'sep']);
  });

  it('scales an explicit multi-product table written in KRW thousands with cell evidence', () => {
    const rows = [
      ['\uCD9C \uBC1C \uC77C', '\uB178\uD301\uB178\uC635\uC158', '\uB514\uB108\uD06C\uB8E8\uC988 \uB178\uD301\uB178\uC635\uC158', '\uC0AC\uD30C \uB178\uD301\uB178\uC635\uC158'],
      ['8/14', '859', '1,099', '1,279'],
    ];
    const cells = rows.flatMap((values, row) => values.map((text, column) => ({
      id: `compact-cell-${row}-${column}`,
      nodeId: `compact-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text,
      evidence: { page: 0, quoteHash: `compact-${row}-${column}` },
    })));
    const text = `26\uB144 8/14 \uCD9C\uBC1C 3\uBC155\uC77C\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4',
      sourceType: 'hwp',
      filename: 'compact-thousands.hwp',
      text,
      pages: 1,
      parser: { engine: 'test', version: '1' },
      nodes: [],
      tables: [{ id: 'compact-thousands-table', page: 0, rows: rows.length, columns: 4, cells }],
      assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result).toHaveLength(3);
    expect(result.map(item => [item.gradeLabel, item.prices[0]?.amount])).toEqual([
      ['\uB178\uD301\uB178\uC635\uC158', 859_000],
      ['\uB514\uB108\uD06C\uB8E8\uC988 \uB178\uD301\uB178\uC635\uC158', 1_099_000],
      ['\uC0AC\uD30C \uB178\uD301\uB178\uC635\uC158', 1_279_000],
    ]);
    expect(result[1]?.prices[0]?.evidence).toEqual(expect.objectContaining({
      quote: '8/14\n1,099',
      extraction_method: 'document_ir_table_cell',
      source_amount_scale: 1000,
    }));
  });

  it('does not scale compact values when the table lacks multiple named product columns', () => {
    const rows = [
      ['\uCD9C\uBC1C\uC77C', '\uC0C1\uD488\uAC00'],
      ['8/14', '1,059'],
    ];
    const cells = rows.flatMap((values, row) => values.map((text, column) => ({
      id: `unsafe-compact-cell-${row}-${column}`,
      nodeId: `unsafe-compact-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text,
      evidence: { page: 0, quoteHash: `unsafe-compact-${row}-${column}` },
    })));
    const text = `26\uB144 8/14 \uCD9C\uBC1C 3\uBC155\uC77C\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4',
      sourceType: 'hwp',
      filename: 'unsafe-compact-thousands.hwp',
      text,
      pages: 1,
      parser: { engine: 'test', version: '1' },
      nodes: [],
      tables: [{ id: 'unsafe-compact-thousands-table', page: 0, rows: rows.length, columns: 2, cells }],
      assets: [],
    };

    expect(buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text })).toEqual([]);
  });

  it.each([
    ['899,', 899_000, null, 'standard_sale', 1000],
    ['839,000 -> 599,000', 599_000, 839_000, 'final_sale', undefined],
  ])('normalizes supplier price cell %s while preserving table evidence', (
    sourcePrice,
    amount,
    listPrice,
    priceRelation,
    sourceAmountScale,
  ) => {
    const rows = [
      ['출발일 [3박 4일]', '상품가'],
      ['8/30', sourcePrice],
    ];
    const cells = rows.flatMap((values, row) => values.map((cellText, column) => ({
      id: `supplier-cell-${row}-${column}`,
      nodeId: `supplier-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text: cellText,
      evidence: { page: 0, quoteHash: `supplier-${row}-${column}` },
    })));
    const text = `2026년\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4',
      sourceType: 'hwp',
      filename: 'supplier-price-format.hwp',
      text,
      pages: 1,
      parser: { engine: 'test', version: '1' },
      nodes: [],
      tables: [{ id: 'supplier-price-table', page: 0, rows: rows.length, columns: 2, cells }],
      assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });
    expect(result).toHaveLength(1);
    expect(result[0]?.prices[0]).toEqual(expect.objectContaining({
      date: '2026-08-30',
      amount,
      list_price: listPrice,
      price_relation: priceRelation,
      evidence: expect.objectContaining({
        quote: `8/30\n${sourcePrice}`,
        ...(sourceAmountScale ? { source_amount_scale: sourceAmountScale } : {}),
      }),
    }));
  });

  it('binds a multiline departure roster to a later single adult sale-price row', () => {
    const rows = [
      ['나트랑 3박5일'],
      ['3/30,31\n4/5,12,13,14,19,21'],
      ['최소 출발 4명'],
      ['1인 판매가 499,000원 (컴 5만원)'],
    ];
    const cells = rows.flatMap((values, row) => values.map((cellText, column) => ({
      id: `roster-cell-${row}-${column}`,
      nodeId: `roster-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text: cellText,
      evidence: { page: 0, quoteHash: `roster-${row}-${column}` },
    })));
    const text = `2026년\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4',
      sourceType: 'hwp',
      filename: 'shared-date-roster-price.hwp',
      text,
      pages: 1,
      parser: { engine: 'test', version: '1' },
      nodes: [],
      tables: [{ id: 'shared-date-roster', page: 0, rows: rows.length, columns: 1, cells }],
      assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result).toHaveLength(1);
    expect(result[0]?.prices).toHaveLength(8);
    expect(result[0]?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-03-30', amount: 499_000 }),
      expect.objectContaining({ date: '2026-03-31', amount: 499_000 }),
      expect.objectContaining({ date: '2026-04-21', amount: 499_000 }),
    ]));
    expect(result[0]?.prices[0]?.evidence).toEqual(expect.objectContaining({
      table_id: 'shared-date-roster',
      quote: '3/30,31\n4/5,12,13,14,19,21\n1인 판매가 499,000원 (컴 5만원)',
    }));
  });

  it('keeps a multiline HWP roster bound when flattened reading order interleaves header cells', () => {
    const makeTable = (id: string, title: string, dates: string, price: string): DocumentIrTable => {
      const rows = [
        [title],
        ['날짜', dates, '룸 타입', '2인 1실'],
        ['인원', '성인 6명부터 출발 가능'],
        ['1인 판매가', price],
      ];
      const cells = rows.flatMap((values, row) => values.map((cellText, column) => ({
        id: `${id}-cell-${row}-${column}`,
        nodeId: `${id}-node-${row}-${column}`,
        row,
        column,
        rowSpan: 1,
        colSpan: 1,
        text: cellText,
        evidence: { page: 0, quoteHash: `${id}-${row}-${column}` },
      })));
      return { id, page: 0, rows: rows.length, columns: 4, cells };
    };
    const vj = makeTable(
      'vj-table',
      '[VJ] 나트랑 라이트팩 3박5일 일정표',
      '3/30,31\n4/5,12,13,14,19,21',
      '1인 판매가 499,000원 (컴 5만원)',
    );
    const vn = makeTable(
      'vn-table',
      '[VN] 나트랑 라이트팩 3박5일 일정표',
      '4/2,15,24',
      '1인 판매가 699,000원 (컴 10만원)',
    );
    const sectionRawText = [
      '[VJ] 나트랑 라이트팩 3박5일 일정표',
      '3/30,31',
      '날짜',
      '룸 타입',
      '4/5,12,13,14,19,21',
      '성인 6명부터 출발 가능',
      '1인 판매가 499,000원 (컴 5만원)',
    ].join('\n');
    const ir: DocumentIR = {
      version: 'v4',
      sourceType: 'hwp',
      filename: 'interleaved-shared-date-roster.hwp',
      text: sectionRawText,
      pages: 1,
      parser: { engine: 'test', version: '1' },
      nodes: [],
      tables: [vj, vn],
      assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({
      documentIr: ir,
      sectionRawText,
      fallbackYear: 2026,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.tableId).toBe('vj-table');
    expect(result[0]?.prices).toHaveLength(8);
    expect(result[0]?.prices.every(price => price.amount === 499_000)).toBe(true);
  });

  it('separates row-spanned products and lets a narrower range override the base price', () => {
    const values = [
      { row: 0, column: 0, rowSpan: 1, text: '상 품 명' },
      { row: 0, column: 1, rowSpan: 1, text: '출발일' },
      { row: 0, column: 2, rowSpan: 1, text: '상 품 가' },
      { row: 1, column: 0, rowSpan: 4, text: '북경/만리장성\n3박4일 실속' },
      { row: 1, column: 1, rowSpan: 1, text: '2/28~3/10\n[연휴제외]' },
      { row: 1, column: 2, rowSpan: 1, text: '339,-' },
      { row: 2, column: 1, rowSpan: 1, text: '3/11~3/28' },
      { row: 2, column: 2, rowSpan: 1, text: '419,-' },
      { row: 3, column: 1, rowSpan: 1, text: '3/29~10/24\n[연휴제외]' },
      { row: 3, column: 2, rowSpan: 1, text: '449,-' },
      { row: 4, column: 1, rowSpan: 1, text: '7/1~7/21' },
      { row: 4, column: 2, rowSpan: 1, text: '379,-' },
      { row: 5, column: 0, rowSpan: 4, text: '북경/고북수진\n노팁노옵션' },
      { row: 5, column: 1, rowSpan: 1, text: '2/28~3/10\n[연휴제외]' },
      { row: 5, column: 2, rowSpan: 1, text: '779,-' },
      { row: 6, column: 1, rowSpan: 1, text: '3/11~3/28' },
      { row: 6, column: 2, rowSpan: 1, text: '849,-' },
      { row: 7, column: 1, rowSpan: 1, text: '3/29~10/24\n[연휴제외]' },
      { row: 7, column: 2, rowSpan: 1, text: '889,-' },
      { row: 8, column: 1, rowSpan: 1, text: '7/1~7/21' },
      { row: 8, column: 2, rowSpan: 1, text: '829,-' },
    ];
    const cells = values.map((cell, index) => ({
      id: `shared-products-cell-${index}`,
      nodeId: `shared-products-node-${index}`,
      row: cell.row,
      column: cell.column,
      rowSpan: cell.rowSpan,
      colSpan: 1,
      text: cell.text,
      evidence: { page: 0, quoteHash: `shared-products-${index}` },
    }));
    const table = { id: 'shared-products', page: 0, rows: 9, columns: 3, cells };
    const ir: DocumentIR = {
      version: 'v4',
      sourceType: 'hwp',
      filename: 'shared-rowspan-product-price.hwp',
      text: cells.map(cell => cell.text).join('\n'),
      pages: 1,
      parser: { engine: 'test', version: '1' },
      nodes: [],
      tables: [table],
      assets: [],
    };
    const sharedContext = cells.map(cell => cell.text).join('\n');
    const sectionRawText = `${sharedContext}\n---\nPKG\n[실속] CA 북경/만리장성 3박4일`;

    const result = buildDocumentIrTablePriceCalendars({
      documentIr: ir,
      sectionRawText,
      fallbackYear: 2026,
      fallbackDurationDays: 4,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      tableId: 'shared-products',
      durationDays: 4,
      gradeLabel: '북경/만리장성 3박4일 실속',
      productLabelKind: 'package_grade',
    });
    expect(result[0]?.prices.find(price => price.date === '2026-07-10')?.amount).toBe(379_000);
    expect(result[0]?.prices.find(price => price.date === '2026-08-15')?.amount).toBe(449_000);
    expect(result[0]?.prices.some(price => price.amount === 889_000)).toBe(false);

    const premium = buildDocumentIrTablePriceCalendars({
      documentIr: ir,
      sectionRawText: `${sharedContext}\n---\nPKG\n노팁/노옵션 CA 북경/고북수진 3박4일`,
      fallbackYear: 2026,
      fallbackDurationDays: 4,
    });
    expect(premium).toHaveLength(1);
    expect(premium[0]?.prices.find(price => price.date === '2026-07-10')?.amount).toBe(829_000);
    expect(premium[0]?.prices.find(price => price.date === '2026-08-15')?.amount).toBe(889_000);
    expect(premium[0]?.prices.some(price => price.amount === 449_000)).toBe(false);
  });

  it('does not reach across rows in a populated multi-column price grid', () => {
    const rows = [
      ['장가계 3박4일'],
      ['출발일', '고품격', '럭셔리'],
      ['6/14 일', '799,000', '1,159,000'],
      ['6/18 목', '★초특가★\n699,000', '1,259,000'],
    ];
    const cells = rows.flatMap((values, row) => values.map((cellText, column) => ({
      id: `grid-cell-${row}-${column}`,
      nodeId: `grid-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text: cellText,
      evidence: { page: 0, quoteHash: `grid-${row}-${column}` },
    })));
    const text = `2026년\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'multi-column-grid.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'multi-column-grid', page: 0, rows: rows.length, columns: 3, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });
    const prices = result.flatMap(calendar => calendar.prices);

    expect(prices).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-06-14', amount: 699_000 }),
    ]));
  });

  it('uses dated exception prices over weekday ranges and leaves inquiry dates unpriced', () => {
    const cells: DocumentIrTable['cells'] = [
      { id: 'h-date', nodeId: 'h-date', row: 0, column: 0, rowSpan: 1, colSpan: 1, text: '출발일', evidence: { page: 0, quoteHash: 'h-date' } },
      { id: 'h-day', nodeId: 'h-day', row: 0, column: 1, rowSpan: 1, colSpan: 1, text: '요일', evidence: { page: 0, quoteHash: 'h-day' } },
      { id: 'h-price', nodeId: 'h-price', row: 0, column: 2, rowSpan: 1, colSpan: 1, text: '노팁 노옵션', evidence: { page: 0, quoteHash: 'h-price' } },
      { id: 'range', nodeId: 'range', row: 1, column: 0, rowSpan: 2, colSpan: 1, text: '9/14 ~ 9/29', evidence: { page: 0, quoteHash: 'range' } },
      { id: 'wd-1', nodeId: 'wd-1', row: 1, column: 1, rowSpan: 1, colSpan: 1, text: '수/목/금', evidence: { page: 0, quoteHash: 'wd-1' } },
      { id: 'p-1', nodeId: 'p-1', row: 1, column: 2, rowSpan: 1, colSpan: 1, text: '669,000', evidence: { page: 0, quoteHash: 'p-1' } },
      { id: 'wd-2', nodeId: 'wd-2', row: 2, column: 1, rowSpan: 1, colSpan: 1, text: '토/일/월/화', evidence: { page: 0, quoteHash: 'wd-2' } },
      { id: 'p-2', nodeId: 'p-2', row: 2, column: 2, rowSpan: 1, colSpan: 1, text: '619,000', evidence: { page: 0, quoteHash: 'p-2' } },
      ...[
        ['9/22', '제외일자', '869,000'],
        ['9/23', '', '1,599,000'],
        ['9/24', '', '1,169,000'],
        ['9/25', '', '별도문의'],
      ].flatMap((values, index) => values.map((text, column) => ({
        id: `special-${index}-${column}`,
        nodeId: `special-${index}-${column}`,
        row: index + 3,
        column,
        rowSpan: 1,
        colSpan: 1,
        text,
        evidence: { page: 0, quoteHash: `special-${index}-${column}` },
      }))),
    ];
    const text = `다낭 3박5일 2026년\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'danang-exceptions.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'danang-exceptions', page: 0, rows: 7, columns: 3, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });
    expect(result).toHaveLength(1);
    expect(result[0]?.prices.find(price => price.date === '2026-09-21')?.amount).toBe(619_000);
    expect(result[0]?.prices.find(price => price.date === '2026-09-22')?.amount).toBe(869_000);
    expect(result[0]?.prices.find(price => price.date === '2026-09-23')?.amount).toBe(1_599_000);
    expect(result[0]?.prices.find(price => price.date === '2026-09-24')?.amount).toBe(1_169_000);
    expect(result[0]?.prices.some(price => price.date === '2026-09-25')).toBe(false);
  });

  it('does not inherit numeric weekday prices into a nested inquiry-only range', () => {
    const cells: DocumentIrTable['cells'] = [
      { id: 'h-period', nodeId: 'h-period', row: 0, column: 0, rowSpan: 1, colSpan: 1, text: '기간', evidence: { page: 0, quoteHash: 'h-period' } },
      { id: 'h-weekday', nodeId: 'h-weekday', row: 0, column: 1, rowSpan: 1, colSpan: 1, text: '요일', evidence: { page: 0, quoteHash: 'h-weekday' } },
      { id: 'h-amount', nodeId: 'h-amount', row: 0, column: 2, rowSpan: 1, colSpan: 1, text: '1인 상품가', evidence: { page: 0, quoteHash: 'h-amount' } },
      { id: 'period', nodeId: 'period', row: 1, column: 0, rowSpan: 4, colSpan: 1, text: '8/12~8/28\n8/8~8/16 별도문의', evidence: { page: 0, quoteHash: 'period' } },
      ...[
        ['월/화/수', '1,239,000'],
        ['목', '1,379,000'],
        ['금/토', '1,449,000'],
        ['일', '1,329,000'],
      ].flatMap((values, index) => values.map((text, offset) => ({
        id: `price-${index}-${offset}`,
        nodeId: `price-${index}-${offset}`,
        row: index + 1,
        column: offset + 1,
        rowSpan: 1,
        colSpan: 1,
        text,
        evidence: { page: 0, quoteHash: `price-${index}-${offset}` },
      }))),
    ];
    const text = `나리타 골프 3박4일 2026년\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'golf-inquiry-range.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'golf-inquiry-range', page: 0, rows: 5, columns: 3, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });
    expect(result).toHaveLength(1);
    expect(result[0]?.prices.some(price => (
      price.date != null && price.date >= '2026-08-12' && price.date <= '2026-08-16'
    ))).toBe(false);
    expect(result[0]?.prices.find(price => price.date === '2026-08-17')?.amount).toBe(1_239_000);
    expect(result[0]?.prices.find(price => price.date === '2026-08-20')?.amount).toBe(1_379_000);
    expect(result[0]?.prices.find(price => price.date === '2026-08-21')?.amount).toBe(1_449_000);
    expect(result[0]?.prices.find(price => price.date === '2026-08-23')?.amount).toBe(1_329_000);
  });

  it('treats a row-spanned broad range as context and binds prices only to the adjacent local roster', () => {
    const cells: DocumentIrTable['cells'] = [
      { id: 'header-period', nodeId: 'header-period', row: 0, column: 0, rowSpan: 1, colSpan: 1, text: '출발 기간', evidence: { page: 0, quoteHash: 'header-period' } },
      { id: 'header-roster', nodeId: 'header-roster', row: 0, column: 1, rowSpan: 1, colSpan: 1, text: '출발일', evidence: { page: 0, quoteHash: 'header-roster' } },
      { id: 'header-price', nodeId: 'header-price', row: 0, column: 2, rowSpan: 1, colSpan: 1, text: '상품가', evidence: { page: 0, quoteHash: 'header-price' } },
      { id: 'august-period', nodeId: 'august-period', row: 1, column: 0, rowSpan: 2, colSpan: 1, text: '8/17~8/31', evidence: { page: 0, quoteHash: 'august-period' } },
      { id: 'august-base-roster', nodeId: 'august-base-roster', row: 1, column: 1, rowSpan: 1, colSpan: 1, text: '월, 수 (8/17, 19, 24, 26, 31)', evidence: { page: 0, quoteHash: 'august-base-roster' } },
      { id: 'august-base-price', nodeId: 'august-base-price', row: 1, column: 2, rowSpan: 1, colSpan: 1, text: '649,000원', evidence: { page: 0, quoteHash: 'august-base-price' } },
      { id: 'august-special-roster', nodeId: 'august-special-roster', row: 2, column: 1, rowSpan: 1, colSpan: 1, text: '특가 8/18, 8/30', evidence: { page: 0, quoteHash: 'august-special-roster' } },
      { id: 'august-special-price', nodeId: 'august-special-price', row: 2, column: 2, rowSpan: 1, colSpan: 1, text: '679,000원', evidence: { page: 0, quoteHash: 'august-special-price' } },
      { id: 'september-period', nodeId: 'september-period', row: 3, column: 0, rowSpan: 3, colSpan: 1, text: '9/1~9/30', evidence: { page: 0, quoteHash: 'september-period' } },
      { id: 'september-base-roster', nodeId: 'september-base-roster', row: 3, column: 1, rowSpan: 1, colSpan: 1, text: '화 (9/1, 8, 15, 22, 29)', evidence: { page: 0, quoteHash: 'september-base-roster' } },
      { id: 'september-base-price', nodeId: 'september-base-price', row: 3, column: 2, rowSpan: 1, colSpan: 1, text: '699,000원', evidence: { page: 0, quoteHash: 'september-base-price' } },
      { id: 'september-special-one', nodeId: 'september-special-one', row: 4, column: 1, rowSpan: 1, colSpan: 1, text: '특가 9/8', evidence: { page: 0, quoteHash: 'september-special-one' } },
      { id: 'september-special-one-price', nodeId: 'september-special-one-price', row: 4, column: 2, rowSpan: 1, colSpan: 1, text: '789,000원', evidence: { page: 0, quoteHash: 'september-special-one-price' } },
      { id: 'september-special-two', nodeId: 'september-special-two', row: 5, column: 1, rowSpan: 1, colSpan: 1, text: '성수기 9/22', evidence: { page: 0, quoteHash: 'september-special-two' } },
      { id: 'september-special-two-price', nodeId: 'september-special-two-price', row: 5, column: 2, rowSpan: 1, colSpan: 1, text: '1,049,000원', evidence: { page: 0, quoteHash: 'september-special-two-price' } },
    ];
    const text = `중중 더블온천팩 3박4일 2026년\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'double-onsen.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'group-range-roster', page: 0, rows: 6, columns: 3, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result).toHaveLength(1);
    expect(result[0]?.prices.map(price => [price.date, price.amount])).toEqual([
      ['2026-08-17', 649_000],
      ['2026-08-18', 679_000],
      ['2026-08-19', 649_000],
      ['2026-08-24', 649_000],
      ['2026-08-26', 649_000],
      ['2026-08-30', 679_000],
      ['2026-08-31', 649_000],
      ['2026-09-01', 699_000],
      ['2026-09-08', 789_000],
      ['2026-09-15', 699_000],
      ['2026-09-22', 1_049_000],
      ['2026-09-29', 699_000],
    ]);
    expect(result[0]?.prices.some(price => price.date === '2026-08-20')).toBe(false);
    expect(result[0]?.prices.filter(price => price.date === '2026-09-08')).toHaveLength(1);
    expect(result[0]?.prices.filter(price => price.date === '2026-09-22')).toHaveLength(1);
  });

  it('keeps row-spanned 3-night and 4-night pattern prices as separate duration products', () => {
    const cells: DocumentIrTable['cells'] = [
      { id: 'h-date', nodeId: 'h-date', row: 0, column: 0, rowSpan: 1, colSpan: 2, text: '출발일', evidence: { page: 0, quoteHash: 'h-date' } },
      { id: 'h-pattern', nodeId: 'h-pattern', row: 0, column: 2, rowSpan: 1, colSpan: 1, text: '패턴', evidence: { page: 0, quoteHash: 'h-pattern' } },
      { id: 'h-price', nodeId: 'h-price', row: 0, column: 3, rowSpan: 1, colSpan: 1, text: '그란디스', evidence: { page: 0, quoteHash: 'h-price' } },
      { id: 'range-a', nodeId: 'range-a', row: 1, column: 0, rowSpan: 2, colSpan: 2, text: '8/16~8/26', evidence: { page: 0, quoteHash: 'range-a' } },
      { id: 'pattern-5', nodeId: 'pattern-5', row: 1, column: 2, rowSpan: 1, colSpan: 1, text: '수 3박5일', evidence: { page: 0, quoteHash: 'pattern-5' } },
      { id: 'price-5', nodeId: 'price-5', row: 1, column: 3, rowSpan: 1, colSpan: 1, text: '729,000', evidence: { page: 0, quoteHash: 'price-5' } },
      { id: 'pattern-6', nodeId: 'pattern-6', row: 2, column: 2, rowSpan: 1, colSpan: 1, text: '토 4박6일', evidence: { page: 0, quoteHash: 'pattern-6' } },
      { id: 'price-6', nodeId: 'price-6', row: 2, column: 3, rowSpan: 1, colSpan: 1, text: '699,000', evidence: { page: 0, quoteHash: 'price-6' } },
      { id: 'except', nodeId: 'except', row: 3, column: 0, rowSpan: 2, colSpan: 1, text: '제외일', evidence: { page: 0, quoteHash: 'except' } },
      { id: 'except-5-date', nodeId: 'except-5-date', row: 3, column: 1, rowSpan: 1, colSpan: 1, text: '8/19', evidence: { page: 0, quoteHash: 'except-5-date' } },
      { id: 'except-5-pattern', nodeId: 'except-5-pattern', row: 3, column: 2, rowSpan: 1, colSpan: 1, text: '수 3박5일', evidence: { page: 0, quoteHash: 'except-5-pattern' } },
      { id: 'except-5-price', nodeId: 'except-5-price', row: 3, column: 3, rowSpan: 1, colSpan: 1, text: '889,000', evidence: { page: 0, quoteHash: 'except-5-price' } },
      { id: 'except-6-date', nodeId: 'except-6-date', row: 4, column: 1, rowSpan: 1, colSpan: 1, text: '8/22', evidence: { page: 0, quoteHash: 'except-6-date' } },
      { id: 'except-6-pattern', nodeId: 'except-6-pattern', row: 4, column: 2, rowSpan: 1, colSpan: 1, text: '토 4박6일', evidence: { page: 0, quoteHash: 'except-6-pattern' } },
      { id: 'except-6-price', nodeId: 'except-6-price', row: 4, column: 3, rowSpan: 1, colSpan: 1, text: '899,000', evidence: { page: 0, quoteHash: 'except-6-price' } },
    ];
    const text = `코타키나발루 2026년 3박5일 4박6일\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'kota-duration-patterns.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'duration-patterns', page: 0, rows: 5, columns: 4, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result).toHaveLength(2);
    expect(result.map(calendar => calendar.durationDays).sort()).toEqual([5, 6]);
    expect(result.find(calendar => calendar.durationDays === 5)?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-08-19', amount: 889_000 }),
      expect.objectContaining({ date: '2026-08-26', amount: 729_000 }),
    ]));
    expect(result.find(calendar => calendar.durationDays === 6)?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-08-22', amount: 899_000 }),
    ]));
  });

  it('uses middle-column dated exceptions over row-spanned weekday ranges without a weekday header', () => {
    const cells: DocumentIrTable['cells'] = [
      { id: 'h-date', nodeId: 'h-date', row: 0, column: 0, rowSpan: 1, colSpan: 1, text: '출 발 일 [컴 12%]', evidence: { page: 0, quoteHash: 'h-date' } },
      { id: 'h-product', nodeId: 'h-product', row: 0, column: 2, rowSpan: 1, colSpan: 1, text: '3박4일 54H', evidence: { page: 0, quoteHash: 'h-product' } },
      { id: 'range', nodeId: 'range', row: 1, column: 0, rowSpan: 7, colSpan: 1, text: '10/1\n–\n10/24', evidence: { page: 0, quoteHash: 'range' } },
      ...[
        ['월', '629,000'],
        ['화/수', '669,000'],
        ['목', '799,000'],
        ['금/토', '829,000'],
        ['일', '759,000'],
        ['10/1 목', '929,000'],
        ['10/2 금', '별도문의'],
      ].flatMap((values, index) => values.map((text, offset) => ({
        id: `row-${index}-${offset}`,
        nodeId: `row-${index}-${offset}`,
        row: index + 1,
        column: offset + 1,
        rowSpan: 1,
        colSpan: 1,
        text,
        evidence: { page: 0, quoteHash: `row-${index}-${offset}` },
      }))),
    ];
    const text = `청도 골프 3박4일 2026년\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'qingdao-rowspan-weekday.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'qingdao-rowspan-weekday', page: 0, rows: 8, columns: 3, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result).toHaveLength(1);
    expect(result[0]?.prices.find(price => price.date === '2026-10-01')?.amount).toBe(929_000);
    expect(result[0]?.prices.some(price => price.date === '2026-10-02')).toBe(false);
    expect(result[0]?.prices.find(price => price.date === '2026-10-05')?.amount).toBe(629_000);
    expect(result[0]?.prices.filter(price => price.date === '2026-10-01')).toHaveLength(1);
  });

  it('splits decorated grade columns across independent duration blocks', () => {
    const rows = [
      ['목요일【성도,구채구,황룡 3박5일】'],
      ['', '✿', 'Premium / 노팁,노옵션+쇼핑2회', '', '♕', 'Crown / 노팁,노옵션,노쇼핑'],
      ['9월 3일', '1,599,000', '', '', '1,749,000', ''],
      ['9월 10일', '1,649,000', '', '', '1,799,000', ''],
      ['일요일【성도,구채구,황룡,낙산 4박6일】'],
      ['', '✿', 'Premium / 노팁,노옵션+쇼핑2회', '', '♕', 'Crown / 노팁,노옵션,노쇼핑'],
      ['9월 6일', '1,699,000', '', '', '1,849,000', ''],
      ['9월 13일', '1,749,000', '', '', '1,899,000', ''],
    ];
    const cells: DocumentIrTable['cells'] = rows.flatMap((values, row) => values.map((text, column) => ({
      id: `cell-${row}-${column}`,
      nodeId: `cell-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text,
      evidence: { page: 0, quoteHash: `cell-${row}-${column}` },
    })));
    const text = `성도 상품 2026년\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'chengdu-grade-duration.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'chengdu-grade-duration', page: 0, rows: rows.length, columns: 6, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result).toHaveLength(4);
    expect(result.map(calendar => [calendar.durationDays, calendar.gradeLabel])).toEqual([
      [5, 'Crown'],
      [5, 'Premium'],
      [6, 'Crown'],
      [6, 'Premium'],
    ]);
    expect(result.find(calendar => calendar.durationDays === 5 && calendar.gradeLabel === 'Premium')?.prices)
      .toEqual(expect.arrayContaining([expect.objectContaining({ date: '2026-09-03', amount: 1_599_000 })]));
    expect(result.find(calendar => calendar.durationDays === 6 && calendar.gradeLabel === 'Crown')?.prices)
      .toEqual(expect.arrayContaining([expect.objectContaining({ date: '2026-09-13', amount: 1_899_000 })]));
  });

  it('keeps adjacent duration amount columns as separate products', () => {
    const cells: DocumentIrTable['cells'] = [
      { id: 'h-date', nodeId: 'h-date', row: 0, column: 0, rowSpan: 1, colSpan: 2, text: '출 발 일 [컴 12%]', evidence: { page: 0, quoteHash: 'h-date' } },
      { id: 'h-3', nodeId: 'h-3', row: 0, column: 2, rowSpan: 1, colSpan: 1, text: '2박3일 36H', evidence: { page: 0, quoteHash: 'h-3' } },
      { id: 'h-4', nodeId: 'h-4', row: 0, column: 3, rowSpan: 1, colSpan: 1, text: '3박4일 54H', evidence: { page: 0, quoteHash: 'h-4' } },
      { id: 'range', nodeId: 'range', row: 1, column: 0, rowSpan: 5, colSpan: 1, text: '9/1–9/30', evidence: { page: 0, quoteHash: 'range' } },
      { id: 'wd-1', nodeId: 'wd-1', row: 1, column: 1, rowSpan: 1, colSpan: 1, text: '월/화/수', evidence: { page: 0, quoteHash: 'wd-1' } },
      { id: 'p3-1', nodeId: 'p3-1', row: 1, column: 2, rowSpan: 1, colSpan: 1, text: '589,000', evidence: { page: 0, quoteHash: 'p3-1' } },
      { id: 'p4-1', nodeId: 'p4-1', row: 1, column: 3, rowSpan: 1, colSpan: 1, text: '679,000', evidence: { page: 0, quoteHash: 'p4-1' } },
      { id: 'wd-2', nodeId: 'wd-2', row: 2, column: 1, rowSpan: 1, colSpan: 1, text: '목', evidence: { page: 0, quoteHash: 'wd-2' } },
      { id: 'p3-2', nodeId: 'p3-2', row: 2, column: 2, rowSpan: 1, colSpan: 1, text: '609,000', evidence: { page: 0, quoteHash: 'p3-2' } },
      { id: 'p4-2', nodeId: 'p4-2', row: 2, column: 3, rowSpan: 1, colSpan: 1, text: '789,000', evidence: { page: 0, quoteHash: 'p4-2' } },
      { id: 'wd-3', nodeId: 'wd-3', row: 3, column: 1, rowSpan: 1, colSpan: 1, text: '금', evidence: { page: 0, quoteHash: 'wd-3' } },
      { id: 'p3-3', nodeId: 'p3-3', row: 3, column: 2, rowSpan: 1, colSpan: 1, text: '729,000', evidence: { page: 0, quoteHash: 'p3-3' } },
      { id: 'p4-3', nodeId: 'p4-3', row: 3, column: 3, rowSpan: 1, colSpan: 1, text: '849,000', evidence: { page: 0, quoteHash: 'p4-3' } },
      { id: 'exact', nodeId: 'exact', row: 4, column: 1, rowSpan: 1, colSpan: 1, text: '9/23 수', evidence: { page: 0, quoteHash: 'exact' } },
      { id: 'p3-exact', nodeId: 'p3-exact', row: 4, column: 2, rowSpan: 1, colSpan: 1, text: '799,000', evidence: { page: 0, quoteHash: 'p3-exact' } },
      { id: 'p4-exact', nodeId: 'p4-exact', row: 4, column: 3, rowSpan: 1, colSpan: 1, text: '별도문의', evidence: { page: 0, quoteHash: 'p4-exact' } },
      { id: 'wd-5', nodeId: 'wd-5', row: 5, column: 1, rowSpan: 1, colSpan: 1, text: '일', evidence: { page: 0, quoteHash: 'wd-5' } },
      { id: 'p3-5', nodeId: 'p3-5', row: 5, column: 2, rowSpan: 1, colSpan: 1, text: '649,000', evidence: { page: 0, quoteHash: 'p3-5' } },
      { id: 'p4-5', nodeId: 'p4-5', row: 5, column: 3, rowSpan: 1, colSpan: 1, text: '739,000', evidence: { page: 0, quoteHash: 'p4-5' } },
    ];
    const text = `청도 시내골프 2026년 2박3일 3박4일\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'qingdao-duration-columns.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'duration-columns', page: 0, rows: 6, columns: 4, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result).toHaveLength(2);
    expect(result.find(calendar => calendar.durationDays === 3)?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-09-23', amount: 799_000 }),
    ]));
    expect(result.find(calendar => calendar.durationDays === 4)?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-09-23', amount: 679_000 }),
    ]));
    expect(result.find(calendar => calendar.durationDays === 4)?.prices.some(price => price.date === '2026-09-23' && price.amount === 799_000)).toBe(false);
  });

  it('keeps repeated airline and grade matrices as independent product axes', () => {
    const values: Array<{ row: number; column: number; rowSpan?: number; colSpan?: number; text: string }> = [
      { row: 0, column: 0, colSpan: 7, text: '[LJ-진에어] 9월 지정일 특가' },
      { row: 1, column: 0, colSpan: 6, text: 'LJ 115 20:05 - 22:55' },
      { row: 1, column: 6, rowSpan: 2, text: '수/금\n3박5일' },
      { row: 2, column: 0, colSpan: 6, text: 'LJ 116 23:55 - 06:40+1' },
      { row: 3, column: 0, colSpan: 2, text: '출발일' },
      { row: 3, column: 2, colSpan: 5, text: '상품가' },
      { row: 4, column: 2, colSpan: 2, text: '노노(라이트팩)' },
      { row: 4, column: 4, colSpan: 3, text: '노노(품격팩)' },
      { row: 5, column: 0, colSpan: 2, text: '9/16, 18' },
      { row: 5, column: 2, colSpan: 2, text: '529,000' },
      { row: 5, column: 4, colSpan: 3, text: '639,000' },
      { row: 6, column: 0, colSpan: 7, text: '[BX-에어부산] 9월 지정일 특가' },
      { row: 7, column: 0, colSpan: 6, text: 'BX 781 19:30 - 22:20' },
      { row: 7, column: 6, rowSpan: 2, text: '매일운항\n3박5일' },
      { row: 8, column: 0, colSpan: 6, text: 'BX 782 23:20 - 06:20+1' },
      { row: 9, column: 0, colSpan: 3, text: '출발일' },
      { row: 9, column: 3, colSpan: 4, text: '상품가' },
      { row: 10, column: 3, colSpan: 2, text: '노노(라이트팩)' },
      { row: 10, column: 5, colSpan: 2, text: '노노(품격팩)' },
      { row: 11, column: 0, colSpan: 3, text: '9/14, 18, 19' },
      { row: 11, column: 3, colSpan: 2, text: '529,000' },
      { row: 11, column: 5, colSpan: 2, text: '659,000' },
    ];
    const cells: DocumentIrTable['cells'] = values.map((cell, index) => ({
      id: `carrier-grade-${index}`,
      nodeId: `carrier-grade-${index}`,
      row: cell.row,
      column: cell.column,
      rowSpan: cell.rowSpan ?? 1,
      colSpan: cell.colSpan ?? 1,
      text: cell.text,
      evidence: { page: 0, quoteHash: `carrier-grade-${index}` },
    }));
    const sharedText = `2026년\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'carrier-grade-matrix.hwp', text: sharedText, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'carrier-grade-matrix', page: 0, rows: 12, columns: 7, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({
      documentIr: ir,
      sectionRawText: `${sharedText}\n---\n[BX] 나트랑/달랏 품격 3박5일 PKG`,
      fallbackDurationDays: 5,
    });

    expect(result.map(calendar => [calendar.transportCode, calendar.gradeLabel])).toEqual([
      ['BX', '라이트'],
      ['BX', '품격'],
      ['LJ', '라이트'],
      ['LJ', '품격'],
    ]);
    expect(result).toHaveLength(4);
    expect(result.find(calendar => calendar.transportCode === 'BX' && calendar.gradeLabel === '품격')?.prices)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ date: '2026-09-18', amount: 659_000 }),
      ]));
    expect(result.find(calendar => calendar.transportCode === 'LJ' && calendar.gradeLabel === '품격')?.prices)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ date: '2026-09-18', amount: 639_000 }),
      ]));
  });

  it('leaves a single-airline three-grade range table to the complete grade parser', () => {
    const values: Array<{ row: number; column: number; rowSpan?: number; text: string }> = [
      { row: 0, column: 0, text: '[BX-에어부산] 3박4일' },
      { row: 1, column: 0, text: '출발일' },
      { row: 1, column: 1, text: '패턴' },
      { row: 1, column: 2, text: '실속' },
      { row: 1, column: 3, text: '고품격' },
      { row: 1, column: 4, text: '럭셔리 & 부용진' },
      { row: 2, column: 0, rowSpan: 2, text: '8/16~8/31' },
      { row: 2, column: 1, text: '토 3박4일' },
      { row: 2, column: 2, text: '399,000' },
      { row: 2, column: 3, text: '859,000' },
      { row: 2, column: 4, text: '1,219,000' },
      { row: 3, column: 1, text: '특가 8/22 토 3박4일' },
      { row: 3, column: 2, text: '299,000' },
      { row: 3, column: 3, text: '699,000' },
      { row: 3, column: 4, text: '999,000' },
    ];
    const cells: DocumentIrTable['cells'] = values.map((cell, index) => ({
      id: `single-carrier-grade-${index}`,
      nodeId: `single-carrier-grade-${index}`,
      row: cell.row,
      column: cell.column,
      rowSpan: cell.rowSpan ?? 1,
      colSpan: 1,
      text: cell.text,
      evidence: { page: 0, quoteHash: `single-carrier-grade-${index}` },
    }));
    const text = `2026년\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'single-carrier-three-grade.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'single-carrier-three-grade', page: 0, rows: 4, columns: 5, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result).toHaveLength(3);
    expect(result.map(calendar => calendar.gradeLabel)).toEqual(['고품격', '럭셔리', '실속']);
    expect(result.find(calendar => calendar.gradeLabel === '럭셔리')?.prices)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ date: '2026-08-22', amount: 999_000 }),
        expect.objectContaining({ date: '2026-08-29', amount: 1_219_000 }),
      ]));
  });

  it('does not treat a hotel proper name ending in luxury as a package grade', () => {
    const rows = [
      ['출발일', '패턴', '4성)무엉탄럭셔리', '5성)래디슨블루'],
      ['8/16~8/31', '목/금 3박5일', '799,000', '859,000'],
      ['8/20', '목 3박5일', '849,000', '909,000'],
    ];
    const cells: DocumentIrTable['cells'] = rows.flatMap((values, row) => values.map((text, column) => ({
      id: `hotel-luxury-${row}-${column}`,
      nodeId: `hotel-luxury-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text,
      evidence: { page: 0, quoteHash: `hotel-luxury-${row}-${column}` },
    })));
    const text = `푸꾸옥 3박5일 2026년\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4', sourceType: 'hwp', filename: 'hotel-luxury-column.hwp', text, pages: 1,
      parser: { engine: 'test', version: '1' }, nodes: [],
      tables: [{ id: 'hotel-luxury-column', page: 0, rows: rows.length, columns: 4, cells }], assets: [],
    };

    const result = buildDocumentIrTablePriceCalendars({ documentIr: ir, sectionRawText: text });

    expect(result.some(calendar => calendar.gradeLabel === '럭셔리')).toBe(false);
  });
});
