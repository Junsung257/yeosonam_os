import { describe, expect, it } from 'vitest';

import type { DocumentIR, DocumentIrTableCell } from './types';
import { buildDocumentIrTableItineraries, buildDocumentIrTableItinerary } from './table-grid-itinerary';

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
  it('accepts exact bare day labels in the date column without treating prose like 2일차 중식 as another day', () => {
    const cells = [
      cell('bare-h0', 0, 0, '일시'), cell('bare-h1', 0, 1, '행선지'),
      cell('bare-h2', 0, 2, '교통편'), cell('bare-h3', 0, 3, '시간'),
      cell('bare-h4', 0, 4, '세부일정'), cell('bare-h5', 0, 5, '식사'),
      cell('bare-d1', 1, 0, '1일'), cell('bare-r1', 1, 1, '부산\n후쿠오카'),
      cell('bare-f1', 1, 2, 'BX142'), cell('bare-t1', 1, 3, '10:00\n10:55'),
      cell('bare-s1', 1, 4, '부산 출발\n후쿠오카 도착'), cell('bare-m1', 1, 5, '중:현지식'),
      cell('bare-d2', 2, 0, '2일'), cell('bare-r2', 2, 1, '아소'),
      cell('bare-f2', 2, 2, ''), cell('bare-t2', 2, 3, ''),
      cell('bare-s2', 2, 4, '오전 관광\n2일차 중식은 불포함'), cell('bare-m2', 2, 5, '조:호텔식'),
      cell('bare-d3', 3, 0, '3일'), cell('bare-r3', 3, 1, '후쿠오카\n부산'),
      cell('bare-f3', 3, 2, 'BX143'), cell('bare-t3', 3, 3, '19:55\n21:00'),
      cell('bare-s3', 3, 4, '후쿠오카 출발\n부산 도착'), cell('bare-m3', 3, 5, '조:호텔식'),
    ];
    const rawText = cells.map(item => item.text).filter(Boolean).join('\n');
    const documentIr: DocumentIR = {
      version: 'v4', filename: '북큐슈 2박3일 PKG.hwp', sourceType: 'hwp', pages: 1, text: rawText,
      nodes: [], assets: [], parser: { engine: 'test', version: '1' },
      tables: [{ id: 'bare-day-table', rows: 4, columns: 6, cells }],
    };

    const result = buildDocumentIrTableItinerary({ documentIr, sectionRawText: rawText });

    expect(result?.days.map(day => day.day)).toEqual([1, 2, 3]);
    expect(result?.days[1]?.events.map(item => item.raw_text)).toContain('2일차 중식은 불포함');
  });

  it('accepts supplier headers that use city name and detailed itinerary labels', () => {
    const cells = [
      cell('clean-h0', 0, 0, '\uB0A0 \uC9DC'), cell('clean-h1', 0, 1, '\uB3C4\uC2DC\uBA85'),
      cell('clean-h2', 0, 2, '\uAD50\uD1B5\uD3B8'), cell('clean-h3', 0, 3, '\uC2DC \uAC04'),
      cell('clean-h4', 0, 4, '\uC0C1 \uC138 \uC77C \uC815'), cell('clean-h5', 0, 5, '\uC2DD \uC0AC'),
      cell('clean-d1', 1, 0, '\uC81C1\uC77C'), cell('clean-r1', 1, 1, '\uBD80\uC0B0\n\uD6C4\uCFE0\uC624\uCE74'),
      cell('clean-f1', 1, 2, 'BX142'), cell('clean-t1', 1, 3, '10:00\n10:55'),
      cell('clean-s1', 1, 4, '\uBD80\uC0B0 \uCD9C\uBC1C\n\uD6C4\uCFE0\uC624\uCE74 \uB3C4\uCC29'), cell('clean-m1', 1, 5, 'L:\uD604\uC9C0\uC2DD'),
      cell('clean-d2', 2, 0, '\uC81C2\uC77C'), cell('clean-r2', 2, 1, '\uC544\uC18C'),
      cell('clean-f2', 2, 2, ''), cell('clean-t2', 2, 3, '08:00'),
      cell('clean-s2', 2, 4, '\uC544\uC18C \uAD00\uAD11'), cell('clean-m2', 2, 5, 'B:\uD638\uD154\uC2DD'),
      cell('clean-d3', 3, 0, '\uC81C3\uC77C'), cell('clean-r3', 3, 1, '\uD6C4\uCFE0\uC624\uCE74\n\uBD80\uC0B0'),
      cell('clean-f3', 3, 2, 'BX143'), cell('clean-t3', 3, 3, '19:55\n21:00'),
      cell('clean-s3', 3, 4, '\uD6C4\uCFE0\uC624\uCE74 \uCD9C\uBC1C\n\uBD80\uC0B0 \uB3C4\uCC29'), cell('clean-m3', 3, 5, 'B:\uD638\uD154\uC2DD'),
    ];
    const rawText = `\uBD80\uC0B0-\uD6C4\uCFE0\uC624\uCE74 2\uBC153\uC77C \uD328\uD0A4\uC9C0\n${cells.map(item => item.text).join('\n')}`;
    const documentIr: DocumentIR = {
      version: 'v4', filename: 'clean-headers.hwp', sourceType: 'hwp', pages: 1, text: rawText,
      nodes: [], assets: [], parser: { engine: 'test', version: '1' },
      tables: [{ id: 'clean-headers', rows: 4, columns: 6, cells }],
    };

    const result = buildDocumentIrTableItinerary({ documentIr, sectionRawText: rawText });

    expect(result?.days.map(day => day.day)).toEqual([1, 2, 3]);
    expect(result?.flightSegments.map(segment => segment.code)).toEqual(['BX142', 'BX143']);
  });

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

  it('returns distinct duration tables as separate itinerary variants', () => {
    const itineraryTable = (prefix: string, duration: number) => {
      const cells = [
        cell(`${prefix}-h0`, 0, 0, '\uB0A0 \uC9DC'), cell(`${prefix}-h1`, 0, 1, '\uC9C0 \uC5ED'),
        cell(`${prefix}-h2`, 0, 2, '\uAD50\uD1B5\uD3B8'), cell(`${prefix}-h3`, 0, 3, '\uC2DC \uAC04'),
        cell(`${prefix}-h4`, 0, 4, '\uC138 \uBD80 \uC0AC \uD56D'), cell(`${prefix}-h5`, 0, 5, '\uC2DD \uC0AC'),
      ];
      for (let day = 1; day <= duration; day += 1) {
        cells.push(
          cell(`${prefix}-d${day}`, day, 0, `\uC81C${day}\uC77C`),
          cell(`${prefix}-r${day}`, day, 1, '\uACC4\uB9BC'),
          cell(`${prefix}-f${day}`, day, 2, ''),
          cell(`${prefix}-t${day}`, day, 3, ''),
          cell(`${prefix}-s${day}`, day, 4, `\uC77C\uC815 ${day}\nHOTEL : \uACC4\uB9BC \uD638\uD154`),
          cell(`${prefix}-m${day}`, day, 5, '\uC870:\uD638\uD154\uC2DD'),
        );
      }
      return { id: prefix, rows: duration + 1, columns: 6, cells };
    };
    const five = itineraryTable('five-days', 5);
    const six = itineraryTable('six-days', 6);
    const rawText = [...five.cells, ...six.cells].map(item => item.text).filter(Boolean).join('\n');
    const documentIr: DocumentIR = {
      version: 'v4', filename: 'duration-variants.hwp', sourceType: 'hwp', pages: 2, text: rawText,
      nodes: [], assets: [], parser: { engine: 'rhwp-wasm', version: '0.8.2' }, tables: [five, six],
    };

    expect(buildDocumentIrTableItineraries({ documentIr, sectionRawText: rawText }).map(item => item.days.length))
      .toEqual([5, 6]);
    expect(buildDocumentIrTableItinerary({ documentIr, sectionRawText: rawText })).toBeNull();
  });

  it('uses the local product duration to reject another catalog product table', () => {
    const makeTable = (prefix: string, duration: number) => {
      const cells = [
        cell(`${prefix}-h0`, 0, 0, '\uB0A0\uC9DC'), cell(`${prefix}-h1`, 0, 1, '\uC9C0\uC5ED'),
        cell(`${prefix}-h2`, 0, 2, '\uAD50\uD1B5\uD3B8'), cell(`${prefix}-h3`, 0, 3, '\uC2DC\uAC04'),
        cell(`${prefix}-h4`, 0, 4, '\uC138\uBD80\uC0AC\uD56D'), cell(`${prefix}-h5`, 0, 5, '\uC2DD\uC0AC'),
      ];
      for (let day = 1; day <= duration; day += 1) {
        cells.push(
          cell(`${prefix}-d${day}`, day, 0, `\uC81C${day}\uC77C`),
          cell(`${prefix}-r${day}`, day, 1, '\uCCAD\uB3C4'),
          cell(`${prefix}-f${day}`, day, 2, ''), cell(`${prefix}-t${day}`, day, 3, ''),
          cell(`${prefix}-s${day}`, day, 4, `\uC77C\uC815 ${day}\nHOTEL : \uCCAD\uB3C4 \uD638\uD154`),
          cell(`${prefix}-m${day}`, day, 5, '\uC870:\uD638\uD154\uC2DD'),
        );
      }
      return { id: prefix, rows: duration + 1, columns: 6, cells };
    };
    const three = makeTable('three-days', 3);
    const four = makeTable('four-days', 4);
    const allTableText = [...three.cells, ...four.cells].map(item => item.text).filter(Boolean).join('\n');
    const sectionRawText = `\uACF5\uD1B5 \uAC00\uACA9\uD45C\n\n---\n\nBX \uCCAD\uB3C4 3\uC0C9\uACE8\uD504 3\uBC154\uC77C PKG\n${allTableText}`;
    const documentIr: DocumentIR = {
      version: 'v4', filename: 'catalog.hwp', sourceType: 'hwp', pages: 2, text: sectionRawText,
      nodes: [], assets: [], parser: { engine: 'rhwp-wasm', version: '0.8.2' }, tables: [three, four],
    };

    expect(buildDocumentIrTableItineraries({ documentIr, sectionRawText }).map(item => item.days.length))
      .toEqual([4]);
  });

  it('accepts a 세부일정 header and attaches a hotel-only continuation row to the current day', () => {
    const cells = [
      cell('h0', 0, 0, '날짜'), cell('h1', 0, 1, '지역'), cell('h2', 0, 2, '교통편'),
      cell('h3', 0, 3, '시간'), cell('h4', 0, 4, '세부일정'), cell('h5', 0, 5, '식사'),
      cell('d1', 1, 0, '제1일'), cell('r1', 1, 1, '부산\n나트랑'), cell('f1', 1, 2, 'BX751'),
      cell('t1', 1, 3, '19:20\n22:20'), cell('s1', 1, 4, '부산 김해공항 출발\n나트랑 도착'), cell('m1', 1, 5, ''),
      cell('hotel1', 2, 4, ': 5성 – 호라이즌 또는 투이블루 동급'),
      cell('d2', 3, 0, '제2일'), cell('r2', 3, 1, '달랏'), cell('f2', 3, 2, ''),
      cell('t2', 3, 3, '전일'), cell('s2', 3, 4, '달랏 관광'), cell('m2', 3, 5, '조:호텔식'),
    ];
    const rawText = cells.map(item => item.text).filter(Boolean).join('\n');
    const documentIr: DocumentIR = {
      version: 'v4', filename: 'continuation-hotel.hwp', sourceType: 'hwp', pages: 1, text: rawText,
      nodes: [], assets: [], parser: { engine: 'rhwp-wasm', version: '0.8.2' },
      tables: [{ id: 'continuation-hotel', rows: 4, columns: 6, cells }],
    };

    const result = buildDocumentIrTableItinerary({ documentIr, sectionRawText: rawText });

    expect(result?.days).toHaveLength(2);
    expect(result?.days[0]?.hotel).toMatchObject({ raw_text: '5성 – 호라이즌 또는 투이블루 동급' });
  });

  it('accepts the spaced 세부 여행 일정 header used by supplier HWP tables', () => {
    const cells = [
      cell('spaced-h0', 0, 0, '일자'), cell('spaced-h1', 0, 1, '지역'),
      cell('spaced-h2', 0, 2, '교통편'), cell('spaced-h3', 0, 3, '시간'),
      cell('spaced-h4', 0, 4, '세부 여행 일정'), cell('spaced-h5', 0, 5, '식사'),
      cell('spaced-d1', 1, 0, '제1일'), cell('spaced-r1', 1, 1, '부산\n호치민'),
      cell('spaced-f1', 1, 2, 'VN423'), cell('spaced-t1', 1, 3, '10:00\n12:55'),
      cell('spaced-s1', 1, 4, '부산 출발\n호치민 도착\n호텔 투숙'), cell('spaced-m1', 1, 5, '석:현지식'),
      cell('spaced-hotel', 2, 4, 'HOTEL : 비사이 사이공 호텔 OR 동급'),
      cell('spaced-d2', 3, 0, '제2일'), cell('spaced-r2', 3, 1, '호치민'),
      cell('spaced-f2', 3, 2, ''), cell('spaced-t2', 3, 3, '전일'),
      cell('spaced-s2', 3, 4, '시내 관광'), cell('spaced-m2', 3, 5, '조:호텔식'),
    ];
    const rawText = cells.map(item => item.text).filter(Boolean).join('\n');
    const documentIr: DocumentIR = {
      version: 'v4', filename: 'spaced-schedule.hwp', sourceType: 'hwp', pages: 1,
      text: rawText, nodes: [], assets: [], parser: { engine: 'test', version: '1' },
      tables: [{ id: 'spaced-schedule', rows: 4, columns: 6, cells }],
    };

    const result = buildDocumentIrTableItinerary({ documentIr, sectionRawText: rawText });

    expect(result?.days.map(day => day.day)).toEqual([1, 2]);
    expect(result?.flightSegments[0]?.code).toBe('VN423');
    expect(result?.days[0]?.hotel.raw_text).toContain('비사이 사이공');
  });

  it('uses the table product title to separate same-duration grade itineraries', () => {
    const makeTable = (id: string, title: string) => ({
      id,
      rows: 4,
      columns: 6,
      cells: [
        cell(`${id}-title`, 0, 0, title, 1, 6),
        cell(`${id}-h0`, 1, 0, '날짜'), cell(`${id}-h1`, 1, 1, '지역'),
        cell(`${id}-h2`, 1, 2, '교통편'), cell(`${id}-h3`, 1, 3, '시간'),
        cell(`${id}-h4`, 1, 4, '세부일정'), cell(`${id}-h5`, 1, 5, '식사'),
        cell(`${id}-d1`, 2, 0, '제1일'), cell(`${id}-r1`, 2, 1, '나트랑'),
        cell(`${id}-f1`, 2, 2, 'BX751'), cell(`${id}-t1`, 2, 3, '19:20\n22:20'),
        cell(`${id}-s1`, 2, 4, '나트랑 도착'), cell(`${id}-m1`, 2, 5, ''),
        cell(`${id}-d2`, 3, 0, '제2일'), cell(`${id}-r2`, 3, 1, '달랏'),
        cell(`${id}-f2`, 3, 2, ''), cell(`${id}-t2`, 3, 3, '전일'),
        cell(`${id}-s2`, 3, 4, '달랏 관광'), cell(`${id}-m2`, 3, 5, '조:호텔식'),
      ],
    });
    const light = makeTable('light', '[실속] 나트랑 라이트 1박2일');
    const premium = makeTable('premium', '[품격] 나트랑 화산 1박2일');
    const documentIr: DocumentIR = {
      version: 'v4', filename: 'grade-itinerary.hwp', sourceType: 'hwp', pages: 1,
      text: [...light.cells, ...premium.cells].map(item => item.text).join('\n'),
      nodes: [], assets: [], parser: { engine: 'test', version: '1' }, tables: [light, premium],
    };
    const sectionRawText = `[실속] 나트랑 라이트 1박2일\n${light.cells.map(item => item.text).join('\n')}`;

    const result = buildDocumentIrTableItineraries({ documentIr, sectionRawText });

    expect(result.map(item => item.tableId)).toEqual(['light']);
  });
});
