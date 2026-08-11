import { describe, expect, it } from 'vitest';

import type { DocumentIR, DocumentIrTableCell } from './types';
import { buildDocumentIrTableItinerary } from './table-grid-itinerary';

function cell(
  id: string,
  row: number,
  column: number,
  text: string,
  rowSpan = 1,
  colSpan = 1,
): DocumentIrTableCell {
  return {
    id,
    row,
    column,
    rowSpan,
    colSpan,
    text,
    nodeId: id,
    evidence: { page: 0, quoteHash: id.padEnd(64, 'a').slice(0, 64) },
  };
}

describe('DocumentIR table-grid itinerary', () => {
  it('keeps merged DAY rows together and binds airport, flight and times from their columns', () => {
    const cells = [
      cell('h0', 0, 0, '일 자'), cell('h1', 0, 1, '지 역'), cell('h2', 0, 2, '교통편'),
      cell('h3', 0, 3, '시 간'), cell('h4', 0, 4, '일 정'), cell('h5', 0, 5, '식 사'),
      cell('d1', 1, 0, '제1일', 2), cell('r1', 1, 1, 'PUS\nMYJ', 2),
      cell('f1', 1, 2, 'BX134', 2), cell('t1', 1, 3, '16:30\n17:35', 2),
      cell('s1', 1, 4, '부산 김해공항 국제선 출발\n일본 마츠야마 국제공항 도착\n호텔 체크인 후 자유일정'),
      cell('m1', 1, 5, '중:불포함\n석:불포함', 2),
      cell('s2', 2, 4, 'HOTEL : 아나크라운 또는 다이와 로이넷 호텔 2인1실'),
      cell('d2', 3, 0, '제2일', 2), cell('r2', 3, 1, '', 2), cell('f2', 3, 2, '', 2),
      cell('t2', 3, 3, '', 2), cell('s3', 3, 4, '상기 골프 장 중 18홀 라운딩(셀프+카트)'),
      cell('m2', 3, 5, '조:호텔식\n중:불포함\n석:불포함', 2), cell('s4', 4, 4, 'HOTEL : 상동'),
      cell('d3', 5, 0, '제3일'), cell('r3', 5, 1, 'MYJ\nPUS'), cell('f3', 5, 2, 'BX133'),
      cell('t3', 5, 3, '18:30\n20:00'), cell('s5', 5, 4, '마츠야마 국제공항 출발\n김해국제공항 도착'),
      cell('m3', 5, 5, '조:호텔식\n중:불포함\n석:불포함'),
    ];
    const rawText = cells.map(item => item.text).filter(Boolean).join('\n');
    const documentIr: DocumentIR = {
      version: 'v4', filename: 'matsuyama.hwp', sourceType: 'hwp', pages: 1, text: rawText,
      nodes: [], assets: [], parser: { engine: 'rhwp-wasm', version: '0.8.2' },
      tables: [{ id: 'itinerary-table', rows: 6, columns: 6, cells }],
    };

    const result = buildDocumentIrTableItinerary({ documentIr, sectionRawText: rawText });

    expect(result?.days.map(day => day.day)).toEqual([1, 2, 3]);
    expect(result?.days[0]?.events.map(item => item.raw_text)).toContain('부산 김해공항 국제선 출발');
    expect(result?.days[0]?.events.map(item => item.raw_text)).not.toContain('상기 골프 장 중 18홀 라운딩(셀프+카트)');
    expect(result?.days[1]?.events.map(item => item.raw_text)).toContain('상기 골프 장 중 18홀 라운딩(셀프+카트)');
    expect(result?.days[1]?.hotel).toMatchObject({
      raw_text: '아나크라운 또는 다이와 로이넷 호텔 2인1실',
      same_as_previous: true,
    });
    expect(result?.flightSegments).toMatchObject([
      { leg: 'outbound', code: 'BX134', dep_airport: 'PUS', arr_airport: 'MYJ', dep_time: '16:30', arr_time: '17:35' },
      { leg: 'inbound', code: 'BX133', dep_airport: 'MYJ', arr_airport: 'PUS', dep_time: '18:30', arr_time: '20:00' },
    ]);
    expect(result?.flightSegments[0]?.evidence).toMatchObject({
      table_id: 'itinerary-table',
      node_id: 'f1',
      extraction_method: 'document_ir_table_cell',
    });
  });
});
