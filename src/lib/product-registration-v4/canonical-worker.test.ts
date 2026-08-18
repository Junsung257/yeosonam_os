import { describe, expect, it } from 'vitest';

import { createTextDocumentIR } from './document-ir';
import { mergeSourceBundleDocumentIR } from './source-bundle-document-ir';
import {
  buildCanonicalNormalization,
  buildCanonicalRevisionSlices,
  canonicalNormalizationJobStatus,
  consolidatePassengerPriceRows,
  diagnoseDocumentIrTableProductSplit,
  extractSourceLodgingAlternative,
  isSourceDepartureDateConfirmed,
  linkSharedDateScopesAcrossVariants,
  linkSharedPriceCalendarsAcrossSections,
  reconcileCatalogPreSplitLocalVariant,
  reconcileTableCommercialIncludedBenefits,
  reconcileTableCommercialGuideTip,
  segmentDocumentIR,
  selectCanonicalSectionForIdentity,
  selectScopedCommercialCandidate,
  sliceCanonicalNormalizationForRevisionSections,
  type CanonicalSection,
} from './canonical-worker';

describe('product registration V4 canonical worker', () => {
  const documentIr = createTextDocumentIR({
    filename: 'supplier.txt',
    sourceType: 'text',
    text: '방콕 3박 5일 패키지\n출발일 2027-01-01\n성인 1,299,000원\n제1일 방콕 도착',
    parserEngine: 'text-utf8',
    parserVersion: '1',
  });

  it('keeps source hotel alternatives as one unconfirmed lodging pool', () => {
    const rawText = [
      '[LJ] 푸꾸옥 3박5일',
      '5성(특급) 솔바이 멜리아 리조트 또는',
      '9/10, 9/18',
      '호 텔',
      '소나가 리조트 또는 동급 기준',
      '2인 1실 또는 3인 1실',
      '포 함',
      '국제선 항공요금, 텍스',
    ].join('\n');

    expect(extractSourceLodgingAlternative(rawText)).toMatchObject({
      customerText: '5성(특급) 솔바이 멜리아 리조트 또는 소나가 리조트 또는 동급 예정',
      evidence: { line_start: 2, line_end: 5 },
    });
  });

  it('does not confuse a normal departure date with an explicitly confirmed departure', () => {
    expect(isSourceDepartureDateConfirmed('출발일\n9/10 799,000원\n9/18 699,000원', '2026-09-10')).toBe(false);
    expect(isSourceDepartureDateConfirmed('★출발확정★ 9/10, 9/18\n699,000원', '2026-09-18')).toBe(true);
    expect(isSourceDepartureDateConfirmed('출발확정일\n9월 10일\n9월 18일', '2026-09-10')).toBe(true);
  });

  it('consolidates adult and occupancy-specific child rows without losing source evidence', () => {
    const evidence = (quote: string) => ({ line_start: 1, line_end: 1, char_start: 0, char_end: quote.length, quote });
    const variants = [{
      price_calendar: [
        { date: '2026-09-01', label: '아동 노베드 토일월화', amount: 979000, currency: 'KRW', evidence: evidence('아동 노베드 979,000원') },
        { date: '2026-09-01', label: '아동 엑베적용 토일월화', amount: 1059000, currency: 'KRW', evidence: evidence('아동 엑베적용 1,059,000원') },
        { date: '2026-09-01', label: '성 인 토일월화', amount: 1339000, currency: 'KRW', evidence: evidence('성인 1,339,000원') },
      ],
    }] as any;

    consolidatePassengerPriceRows(variants);

    expect(variants[0].price_calendar).toHaveLength(1);
    expect(variants[0].price_calendar[0]).toMatchObject({ amount: 1339000, label: '성 인 토일월화' });
    expect(variants[0].price_calendar[0].passenger_prices).toMatchObject([
      { passenger_type: 'child', occupancy_type: 'without_bed', amount: 979000, evidence: { quote: '아동 노베드 979,000원' } },
      { passenger_type: 'child', occupancy_type: 'with_bed', amount: 1059000, evidence: { quote: '아동 엑베적용 1,059,000원' } },
    ]);
  });

  it('uses a typed inclusion cell to correct a priced guide-tip misclassification', () => {
    const quote = '▶ 왕복 항공료, 호텔, 기사/가이드 경비 $50';
    const typedCellQuote = `${quote}\n▶ 차량, 식사, 여행자보험`;
    const evidence = { line_start: 3, line_end: 3, char_start: 10, char_end: 30, quote };
    const variant = {
      structured_facts: [{
        category: 'guide_tip',
        values: { included: false, amount: 50, currency: 'USD', payment: 'local' },
        evidence: [evidence],
        risk_level: 'high',
        visibility: 'customer_visible',
        review_status: 'review_needed',
        standard_text: '가이드/기사 팁은 1인 기준 원 현지 지불입니다.',
      }],
      standard_notices: [{
        source_text: quote,
        category: 'tip_guideline',
        template_key: 'guide.tip_amount_local_payment',
        values: { amount: 50, currency: 'USD', per: null },
        evidence: [evidence],
        visibility: 'customer_visible',
        risk_level: 'high',
        review_status: 'review_needed',
        standard_text: '가이드/기사 팁은 1인 기준 원 현지 지불입니다.',
      }],
    } as any;
    const applied = reconcileTableCommercialGuideTip(variant, {
      tableId: 'product-table',
      inclusions: [{ value: '기사/가이드 경비 $50', evidence: { ...evidence, quote: typedCellQuote } }],
      exclusions: [{ value: '개인경비 및 매너팁', evidence: { ...evidence, quote: '개인경비 및 매너팁' } }],
      sourceNodeIds: [],
    });

    expect(applied).toBe(true);
    expect(variant.structured_facts[0].values).toMatchObject({ included: true, amount: null });
    expect(variant.standard_notices[0]).toMatchObject({
      template_key: 'guide.tip_included',
      values: { included: true },
      review_status: 'auto_clean',
    });
  });

  it('does not treat a source-backed included benefit as an optional tour', () => {
    const includedQuote = '판랑 오프로드 지프차 투어 A코스 포함($30 상당)';
    const optionalQuote = '머드온천 선택관광 $50';
    const variant = {
      options: [{
        raw_name: includedQuote,
        evidence: { quote: includedQuote },
      }, {
        raw_name: optionalQuote,
        evidence: { quote: optionalQuote },
      }],
    } as any;

    const applied = reconcileTableCommercialIncludedBenefits(variant, {
      tableId: 'product-table',
      inclusions: [{
        value: includedQuote,
        evidence: { line_start: 2, line_end: 2, char_start: 10, char_end: 40, quote: includedQuote },
      }],
      exclusions: [],
      sourceNodeIds: [],
    });

    expect(applied).toBe(true);
    expect(variant.options).toHaveLength(1);
    expect(variant.options[0]?.raw_name).toBe(optionalQuote);
  });

  it('keeps shopping, option, and guide facts scoped to their explicit price grade axis', async () => {
    const makeTable = (prefix: string, rows: string[][]) => ({
      id: `${prefix}-table`,
      rows: rows.length,
      columns: Math.max(...rows.map(row => row.length)),
      cells: rows.flatMap((values, row) => values.flatMap((text, column) => text ? [{
        id: `${prefix}-${row}-${column}`,
        nodeId: `${prefix}-node-${row}-${column}`,
        row,
        column,
        rowSpan: 1,
        colSpan: 1,
        text,
        evidence: { page: 0, quoteHash: `${prefix}-${row}-${column}` },
      }] : [])),
    });
    const price = makeTable('price', [
      ['출발일 & 2박3일', '', '실속', '노옵션', '품격(노노노)'],
      ['9/23', '', '699,000', '899,000', '999,000'],
    ]);
    price.cells.find(cell => cell.row === 0 && cell.column === 0)!.colSpan = 2;
    const product = (prefix: string, grade: string, option: string, shopping: string, guide: string) => makeTable(prefix, [
      [grade, '청도 한바퀴 3일'],
      ['포함 내역', `왕복항공료, 호텔${guide === '포함' ? ', 기사/가이드경비' : ''}`],
      ['불포함 내역', guide === '포함' ? '개인경비' : '기사/가이드경비 $40, 개인경비'],
      ['선택관광', option],
      ['쇼핑센터', shopping],
      ['제1일', 'BX321 부산 출발 10:30 청도 도착 11:35'],
      ['제2일', '청도 관광, 호텔 투숙'],
      ['제3일', 'BX322 청도 출발 12:30 부산 도착 15:30'],
    ]);
    const tables = [
      price,
      product('value', '실속', '맥주박물관 $35', '쇼핑 2회', '현지'),
      product('no-option', '노옵션', '노옵션', '쇼핑 2회', '현지'),
      product('premium', '품격', '노옵션', '노쇼핑', '포함'),
    ];
    const text = tables.flatMap(table => table.cells.map(cell => cell.text)).join('\n');
    const ir = {
      ...createTextDocumentIR({
        filename: 'three-grade-commercial-scope.hwp', sourceType: 'hwp', text,
        parserEngine: 'test', parserVersion: '1',
      }),
      tables,
    };

    const normalized = await buildCanonicalNormalization({
      documentIr: ir,
      sourceDocumentId: 'source-three-grade-commercial-scope',
      extractionId: 'extract-three-grade-commercial-scope',
      departureDateReference: { referenceDate: '2026-08-16', rollingInferenceEligible: true },
    });
    const variants = (normalized.canonicalPayload.sections as Array<Record<string, any>>)[0]!.v3.ledger.variants;
    const byGrade = new Map<string, any>(variants.map((variant: any) => [variant.grade, variant]));
    const noticeKeys = (grade: string) => byGrade.get(grade).standard_notices.map((notice: any) => notice.template_key);

    expect(variants).toHaveLength(3);
    expect(byGrade.get('실속').options.length).toBeGreaterThan(0);
    expect(noticeKeys('실속')).not.toContain('optional.none');
    expect(noticeKeys('노옵션')).toContain('optional.none');
    expect(byGrade.get('노옵션').shopping.length).toBeGreaterThan(0);
    expect(noticeKeys('품격')).toContain('optional.none');
    expect(noticeKeys('품격')).toContain('shopping.none');
    expect(noticeKeys('품격')).toContain('guide.tip_included');
    expect(byGrade.get('품격').shopping).toHaveLength(0);
  });

  it('scopes repeated grade policies by both grade and trip duration', async () => {
    const candidate = (grade: string, durationDays: number, tableId: string) => ({
      terms: { tableId, inclusions: [], exclusions: [], sourceNodeIds: [] },
      durationDays,
      customerVariant: null,
      table: {
        id: tableId,
        rows: 1,
        columns: 1,
        cells: [{
          id: `${tableId}-cell`, nodeId: `${tableId}-node`, row: 0, column: 0,
          rowSpan: 1, colSpan: 1, text: grade,
          evidence: { page: 0, quoteHash: `${tableId}-hash` },
        }],
      },
    });
    const candidates = [
      candidate('Premium', 5, 'premium-five'),
      candidate('Crown', 5, 'crown-five'),
      candidate('Premium', 6, 'premium-six'),
      candidate('Crown', 6, 'crown-six'),
    ];

    expect(selectScopedCommercialCandidate({ grade: 'Premium', duration_days: 5 } as any, candidates as any)?.terms.tableId)
      .toBe('premium-five');
    expect(selectScopedCommercialCandidate({ grade: 'Crown', duration_days: 6 } as any, candidates as any)?.terms.tableId)
      .toBe('crown-six');
    expect(selectScopedCommercialCandidate({ grade: 'Premium', duration_days: null } as any, candidates as any))
      .toBeNull();
  });

  it('uses the source product duration to bind a weekday price roster when no table itinerary is available', async () => {
    const rows = [
      ['청주-석가장 태항산 4일–노팁/노옵션/노쇼핑', '', ''],
      ['상 품 가', '< 매주 수요일 출발 >', '최소출발인원 10명'],
      ['', '09월 2일, 9일, 16일, 23일, 30일', '￦899,000 /인'],
      ['포함 내역', '항공료, 호텔, 차량, 가이드경비', ''],
      ['불포함 내역', '개인경비, 싱글차지', ''],
    ];
    const cells = rows.flatMap((values, row) => values.flatMap((text, column) => text ? [{
      id: `weekday-canonical-${row}-${column}`,
      nodeId: `weekday-canonical-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text,
      evidence: { page: 0, quoteHash: `weekday-canonical-${row}-${column}` },
    }] : []));
    const text = [
      ...cells.map(cell => cell.text),
      '제1일 청주 출발 석가장 도착 호텔 투숙',
      '제2일 태항산 관광 호텔 투숙',
      '제3일 현지 관광 호텔 투숙',
      '제4일 석가장 출발 청주 도착',
    ].join('\n');
    const ir = {
      ...createTextDocumentIR({
        filename: '26년 태항산 4일.hwp', sourceType: 'hwp', text,
        parserEngine: 'test', parserVersion: '1',
      }),
      tables: [{ id: 'weekday-canonical-price', page: 0, rows: rows.length, columns: 3, cells }],
    };

    const normalized = await buildCanonicalNormalization({
      documentIr: ir,
      sourceDocumentId: 'source-weekday-canonical-price',
      extractionId: 'extract-weekday-canonical-price',
      departureDateReference: { referenceDate: '2026-08-16', rollingInferenceEligible: true },
    });
    const variant = (normalized.canonicalPayload.sections as Array<Record<string, any>>)[0]!.v3.ledger.variants[0];

    expect(variant.duration_days).toBe(4);
    expect(variant.price_calendar).toHaveLength(5);
    expect(variant.price_calendar).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-09-02', amount: 899_000 }),
      expect.objectContaining({ date: '2026-09-30', amount: 899_000 }),
    ]));
  });

  it('keeps ambiguous duplicate adult prices separate so publication remains blocked', () => {
    const variants = [{
      price_calendar: [
        { date: '2026-09-01', label: '성인 A', amount: 1299000, currency: 'KRW', evidence: { quote: '성인 A 1,299,000원' } },
        { date: '2026-09-01', label: '성인 B', amount: 1399000, currency: 'KRW', evidence: { quote: '성인 B 1,399,000원' } },
      ],
    }] as any;

    consolidatePassengerPriceRows(variants);

    expect(variants[0].price_calendar).toHaveLength(2);
  });

  it('creates one deterministic section when no catalog boundary exists', () => {
    const segmented = segmentDocumentIR(documentIr, 'source-1');
    expect(segmented.segmentationSource).toBe('single-document');
    expect(segmented.sections).toHaveLength(1);
    expect(segmented.sections[0]?.rawTextHash).toHaveLength(64);
    expect(segmented.sections[0]?.sourceNodeIds.length).toBeGreaterThan(0);
  });

  it('separates independent same-duration product tables before customer facts are normalized', () => {
    const makeCells = (prefix: string, rows: string[][]) => rows.flatMap((values, row) => (
      values.flatMap((text, column) => text ? [{
        id: `${prefix}-cell-${row}-${column}`,
        nodeId: `${prefix}-node-${row}-${column}`,
        row,
        column,
        rowSpan: 1,
        colSpan: 1,
        text,
        evidence: { page: 0, quoteHash: `${prefix}-${row}-${column}` },
      }] : [])
    ));
    const priceRows = [
      ['출발일', '실속', '노옵션'],
      ['9월 매주 화요일', '349,000', '569,000'],
      ['9/22', '449,000', '669,000'],
    ];
    const productRows = (grade: string, policy: string, hotel: string) => [
      [grade, `청도 한바퀴 3일 ${policy}`],
      ['포함 내역', grade === '실속' ? '왕복항공료, 호텔' : '왕복항공료, 호텔, 선택관광'],
      ['불포함 내역', grade === '실속' ? '가이드경비 $40, 선택관광' : '가이드경비 $40'],
      ['일 자', '지 역', '교통편', '시간', '일 정', '식 사'],
      ['제1일', '부산/청도', 'BX321', '10:30', '청도 도착', '중식'],
      ['제2일', '청도', '전용차량', '전일', `${hotel} 투숙`, '호텔식'],
      ['제3일', '청도/부산', 'BX322', '12:30', '부산 도착', '조식'],
    ];
    const priceCells = makeCells('price', priceRows);
    const valueCells = makeCells('value', productRows('실속', '선택관광 가능', '알파 호텔'));
    const noOptionCells = makeCells('no-option', productRows('노옵션', '노옵션', '베타 호텔'));
    const tableText = (cells: typeof priceCells) => cells
      .sort((left, right) => left.row - right.row || left.column - right.column)
      .map(cell => cell.text)
      .join('\n');
    const text = [tableText(priceCells), tableText(valueCells), tableText(noOptionCells)].join('\n');
    const ir = {
      ...createTextDocumentIR({
        filename: 'same-duration-products.hwp', sourceType: 'hwp', text,
        parserEngine: 'test', parserVersion: '1',
      }),
      tables: [
        { id: 'price-table', rows: priceRows.length, columns: 3, cells: priceCells },
        { id: 'value-table', rows: 7, columns: 6, cells: valueCells },
        { id: 'no-option-table', rows: 7, columns: 6, cells: noOptionCells },
      ],
    };

    const result = segmentDocumentIR(ir, 'source-table-products');

    expect(result.segmentationSource).toBe('document-ir-table-products');
    expect(result.sections).toHaveLength(2);
    expect(result.sections.map(section => section.titleHint)).toEqual([
      '실속 청도 한바퀴 3일 선택관광 가능',
      '노옵션 청도 한바퀴 3일 노옵션',
    ]);
    expect(result.sections[0]?.rawText).toContain('349,000');
    expect(result.sections[0]?.rawText).toContain('알파 호텔');
    expect(result.sections[0]?.rawText).not.toContain('베타 호텔');
    expect(result.sections[1]?.rawText).toContain('베타 호텔');
    expect(result.sections[1]?.rawText).not.toContain('알파 호텔');
  });

  it('groups adjacent commercial and itinerary tables as independent products', () => {
    const makeTable = (prefix: string, rows: string[][]) => ({
      id: `${prefix}-table`,
      rows: rows.length,
      columns: Math.max(...rows.map(row => row.length)),
      cells: rows.flatMap((values, row) => values.flatMap((text, column) => text ? [{
        id: `${prefix}-${row}-${column}`,
        nodeId: `${prefix}-node-${row}-${column}`,
        row,
        column,
        rowSpan: 1,
        colSpan: 1,
        text,
        evidence: { page: 0, quoteHash: `${prefix}-${row}-${column}` },
      }] : [])),
    });
    const price = makeTable('price', [
      ['적용기간', '요일', '노쇼핑 4일', '품격 노옵션 4일'],
      ['9/1~9/30일', '화', '1,099,000', '1,249,000'],
      ['9/23', '수', '1,199,000', '1,349,000'],
    ]);
    const productOne = makeTable('one-commercial', [
      ['[노쇼핑] 타이베이 단수이 예스지 4일'],
      ['포함 사항', '항공료, 호텔'],
      ['불포함 사항', '가이드경비'],
      ['옵션', '발마사지 $30'],
      ['쇼핑', '노쇼핑'],
    ]);
    const itineraryOne = makeTable('one-itinerary', [
      ['날짜', '지역', '교통편', '시간', '세부일정', '식사'],
      ['제1일', '부산/타이베이', 'CI189', '12:15', '타이베이 도착', '석식'],
      ['제2일', '타이베이', '전용차량', '전일', '알파호텔 투숙', '호텔식'],
      ['제3일', '단수이', '전용차량', '전일', '단수이 관광', '호텔식'],
      ['제4일', '타이베이/부산', 'CI186', '15:45', '부산 도착', '조식'],
    ]);
    const productTwo = makeTable('two-commercial', [
      ['[품격] 타이베이 온천호텔 노옵션 4일'],
      ['포함 사항', '항공료, 온천호텔'],
      ['불포함 사항', '가이드경비'],
      ['옵션', '노옵션'],
      ['쇼핑', '쇼핑 2회'],
    ]);
    const itineraryTwo = makeTable('two-itinerary', [
      ['날짜', '지역', '교통편', '시간', '세부일정', '식사'],
      ['제1일', '부산/타이베이', 'CI189', '12:15', '타이베이 도착', '석식'],
      ['제2일', '타이베이', '전용차량', '전일', '베타온천호텔 투숙', '호텔식'],
      ['제3일', '예류', '전용차량', '전일', '예류 관광', '호텔식'],
      ['제4일', '타이베이/부산', 'CI186', '15:45', '부산 도착', '조식'],
    ]);
    const tables = [price, productOne, itineraryOne, productTwo, itineraryTwo];
    const text = tables.flatMap(table => table.cells.map(cell => cell.text)).join('\n');
    const ir = {
      ...createTextDocumentIR({
        filename: 'adjacent-product-groups.hwp', sourceType: 'hwp', text,
        parserEngine: 'test', parserVersion: '1',
      }),
      tables,
    };

    const result = segmentDocumentIR(ir, 'source-adjacent-product-groups');

    expect(result.segmentationSource).toBe('document-ir-table-products');
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]?.rawText).toContain('[노쇼핑] 타이베이');
    expect(result.sections[0]?.rawText).not.toContain('[품격] 타이베이');
    expect(result.sections[1]?.rawText).toContain('[품격] 타이베이');
    expect(result.sections[1]?.rawText).not.toContain('[노쇼핑] 타이베이');
    expect(result.sections[0]?.rawText).toContain('1,099,000');
    expect(result.sections[0]?.rawText).not.toContain('1,249,000');
    expect(result.sections[1]?.rawText).toContain('1,249,000');
    expect(result.sections[1]?.rawText).not.toContain('1,099,000');
    expect(result.sections.map(section => section.titleHint)).toEqual([
      '[노쇼핑] 타이베이 단수이 예스지 4일',
      '[품격] 타이베이 온천호텔 노옵션 4일',
    ]);
  });

  it('maps shared two-column price tables across independent duration variants', () => {
    const makeTable = (prefix: string, rows: string[][]) => ({
      id: `${prefix}-table`,
      rows: rows.length,
      columns: Math.max(...rows.map(row => row.length)),
      cells: rows.flatMap((values, row) => values.flatMap((text, column) => text ? [{
        id: `${prefix}-${row}-${column}`,
        nodeId: `${prefix}-node-${row}-${column}`,
        row,
        column,
        rowSpan: 1,
        colSpan: 1,
        text,
        evidence: { page: 0, quoteHash: `${prefix}-${row}-${column}` },
      }] : [])),
    });
    const priceFourDays = makeTable('four-day-price', [
      ['기간', '요일', '날짜', '노팁+노옵션', '노쇼핑+노옵션+노팁'],
      ['6/1~6/30 매일 출발 3박4일'],
      ['', '', '6/9', '999,000', '1,199,000'],
      ['', '', '6/18', '1,169,000', '1,369,000'],
    ]);
    priceFourDays.cells.find(cell => cell.row === 1 && cell.column === 0)!.colSpan = 5;
    const priceMixed = makeTable('mixed-price', [
      ['기간', '요일', '날짜', '노팁+노옵션', '노쇼핑+노옵션+노팁'],
      ['9/1-26', '3일', '토', '899,000', '1,099,000'],
      ['', '4일', '월', '949,000', '1,149,000'],
      ['', '', '9/23', '1,599,000', '1,799,000'],
    ]);
    const productTable = (prefix: string, title: string, hotel: string, days: number) => makeTable(prefix, [
      [title],
      ['포함 사항', '항공료, 호텔, 기사 가이드팁'],
      ['불포함 사항', '개인경비'],
      ['쇼핑정보', title.includes('노쇼핑') ? '노쇼핑' : '쇼핑 2회'],
      ['날짜', '지역', '교통편', '시간', '일정', '식사'],
      ...Array.from({ length: days }, (_, index) => [
        `제${index + 1}일`,
        index === 0 ? '부산/연길' : '연길',
        index === 0 ? 'BX337' : '전용차량',
        index === 0 ? '09:40' : '전일',
        index === days - 1 ? '부산 도착' : `${hotel} 투숙`,
        '호텔식',
      ]),
    ]);
    const products = [
      productTable('four-regular', '[노옵션+노팁] 연길 백두산 4일', '금수학호텔', 4),
      productTable('four-no-shopping', '[노쇼핑+노옵션+노팁] 연길 백두산 4일', '다이너스티호텔', 4),
      productTable('three-regular', '[노옵션+노팁] 연길 백두산 3일', '금수학호텔', 3),
      productTable('three-no-shopping', '[노쇼핑+노옵션+노팁] 연길 백두산 3일', '다이너스티호텔', 3),
    ];
    const tables = [priceFourDays, priceMixed, ...products];
    const text = tables.flatMap(table => table.cells.map(cell => cell.text)).join('\n');
    const ir = {
      ...createTextDocumentIR({
        filename: 'four-products-two-price-columns.hwp', sourceType: 'hwp', text,
        parserEngine: 'test', parserVersion: '1',
      }),
      tables,
    };

    const result = segmentDocumentIR(ir, 'source-four-products-two-columns');

    expect(result.segmentationSource).toBe('document-ir-table-products');
    expect(result.sections).toHaveLength(4);
    expect(result.sections[0]?.rawText).toContain('999,000');
    expect(result.sections[0]?.rawText).not.toContain('1,199,000');
    expect(result.sections[0]?.rawText).not.toContain('899,000');
    expect(result.sections[1]?.rawText).toContain('1,199,000');
    expect(result.sections[1]?.rawText).not.toContain('999,000');
    expect(result.sections[2]?.rawText).toContain('899,000');
    expect(result.sections[2]?.rawText).not.toContain('949,000');
    expect(result.sections[3]?.rawText).toContain('1,099,000');
    expect(result.sections[3]?.rawText).not.toContain('1,149,000');
    expect(result.sections.map(section => section.titleHint)).toEqual([
      '[노옵션+노팁] 연길 백두산 4일',
      '[노쇼핑+노옵션+노팁] 연길 백두산 4일',
      '[노옵션+노팁] 연길 백두산 3일',
      '[노쇼핑+노옵션+노팁] 연길 백두산 3일',
    ]);
  });

  it('counts a merged price cell as one grade axis', () => {
    const makeTableCells = (prefix: string, rows: string[][]) => rows.flatMap((values, row) => (
      values.flatMap((text, column) => text ? [{
        id: `${prefix}-${row}-${column}`,
        nodeId: `${prefix}-node-${row}-${column}`,
        row,
        column,
        rowSpan: 1,
        colSpan: 1,
        text,
        evidence: { page: 0, quoteHash: `${prefix}-${row}-${column}` },
      }] : [])
    ));
    const makeTable = (prefix: string, title: string, policy: string) => {
      const rows = [
        [title],
        ['포함 내역', '왕복항공료, 호텔'],
        ['불포함 내역', policy],
        ['일 자', '지 역', '교통편', '시간', '일 정', '식 사'],
        ['제1일', '부산/장가계', 'BX371', '09:00', '장가계 도착', '중식'],
        ['제2일', '장가계', '전용차량', '전일', '현지 관광', '호텔식'],
        ['제3일', '장가계', '전용차량', '전일', '현지 관광', '호텔식'],
        ['제4일', '장가계/부산', 'BX372', '12:20', '부산 도착', '조식'],
      ];
      return {
        id: `${prefix}-table`,
        rows: rows.length,
        columns: 6,
        cells: makeTableCells(prefix, rows),
      };
    };
    const priceTable = {
      id: 'merged-grade-price-table',
      rows: 3,
      columns: 4,
      cells: [
        { id: 'p-0-0', nodeId: 'p-0-0', row: 0, column: 0, rowSpan: 1, colSpan: 1, text: '출발일', evidence: { page: 0, quoteHash: 'p-0-0' } },
        { id: 'p-0-1', nodeId: 'p-0-1', row: 0, column: 1, rowSpan: 1, colSpan: 2, text: '세이브', evidence: { page: 0, quoteHash: 'p-0-1' } },
        { id: 'p-0-3', nodeId: 'p-0-3', row: 0, column: 3, rowSpan: 1, colSpan: 1, text: '스탠다드', evidence: { page: 0, quoteHash: 'p-0-3' } },
        { id: 'p-1-0', nodeId: 'p-1-0', row: 1, column: 0, rowSpan: 1, colSpan: 1, text: '9/1 월', evidence: { page: 0, quoteHash: 'p-1-0' } },
        { id: 'p-1-1', nodeId: 'p-1-1', row: 1, column: 1, rowSpan: 1, colSpan: 2, text: '469,000', evidence: { page: 0, quoteHash: 'p-1-1' } },
        { id: 'p-1-3', nodeId: 'p-1-3', row: 1, column: 3, rowSpan: 1, colSpan: 1, text: '789,000', evidence: { page: 0, quoteHash: 'p-1-3' } },
        { id: 'p-2-0', nodeId: 'p-2-0', row: 2, column: 0, rowSpan: 1, colSpan: 1, text: '9/7 일', evidence: { page: 0, quoteHash: 'p-2-0' } },
        { id: 'p-2-1', nodeId: 'p-2-1', row: 2, column: 1, rowSpan: 1, colSpan: 2, text: '549,000', evidence: { page: 0, quoteHash: 'p-2-1' } },
        { id: 'p-2-3', nodeId: 'p-2-3', row: 2, column: 3, rowSpan: 1, colSpan: 1, text: '869,000', evidence: { page: 0, quoteHash: 'p-2-3' } },
      ],
    };
    const save = makeTable('save', '장가계 세이브 3박4일', '기사/가이드경비 $40, 선택관광');
    const standard = makeTable('standard', '장가계 스탠다드 노팁 노옵션 3박4일', '개인경비');
    const tables = [priceTable, save, standard];
    const text = tables.flatMap(table => table.cells.map(cell => cell.text)).join('\n');
    const ir = {
      ...createTextDocumentIR({
        filename: 'merged-price-axis.hwp', sourceType: 'hwp', text,
        parserEngine: 'test', parserVersion: '1',
      }),
      tables,
    };

    const diagnosis = diagnoseDocumentIrTableProductSplit(ir);

    expect(diagnosis.sharedTables[0]).toMatchObject({
      priceColumns: [1, 3],
      assignments: [1, 3],
    });
  });

  it('reuses one amount column only across proven duration row blocks', () => {
    const priceRows = [
      ['광저우 천저우 특가', '', '', ''],
      ['날짜', '', '3N5D', '금액'],
      ['9월 9일', '', '', '499,000'],
      ['9월 16일', '', '', '599,000'],
      ['날짜', '4N6D', '', '금액'],
      ['9월 5일', '', '', '599,000'],
      ['9월 12, 19, 26일', '', '', '699,000'],
    ];
    const priceCells = priceRows.flatMap((values, row) => values.flatMap((text, column) => text ? [{
      id: `one-price-${row}-${column}`,
      nodeId: `one-price-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: column === 0 && /^\d/u.test(text) ? 3 : 1,
      text,
      evidence: { page: 0, quoteHash: `one-price-${row}-${column}` },
    }] : []));
    const makeProduct = (prefix: string, title: string, days: number) => {
      const rows = [
        [title],
        ['포함 내역', '왕복항공료, 호텔, 식사'],
        ['불포함 내역', '개인경비, 싱글차지'],
        ['일 자', '지 역', '교통편', '시간', '일 정', '식 사'],
        ...Array.from({ length: days }, (_, index) => [
          `제${index + 1}일`,
          index === 0 ? '부산' : '현지',
          index === 0 ? 'BX3115' : '전용차량',
          index === 0 ? '22:00' : '전일',
          index === days - 1 ? '부산 도착' : '현지 일정 및 호텔 투숙',
          '호텔식',
        ]),
      ];
      const cells = rows.flatMap((values, row) => values.flatMap((text, column) => text ? [{
        id: `${prefix}-${row}-${column}`,
        nodeId: `${prefix}-node-${row}-${column}`,
        row,
        column,
        rowSpan: 1,
        colSpan: 1,
        text,
        evidence: { page: 0, quoteHash: `${prefix}-${row}-${column}` },
      }] : []));
      return { id: prefix, page: 0, rows: rows.length, columns: 6, cells };
    };
    const priceTable = { id: 'one-price-duration-table', page: 0, rows: priceRows.length, columns: 4, cells: priceCells };
    const five = makeProduct('five-day', '광저우 3N5D 일정표', 5);
    const six = makeProduct('six-day', '광저우 4N6D 일정표', 6);
    const tables = [priceTable, five, six];
    const text = tables.flatMap(table => table.cells.map(cell => cell.text)).join('\n');
    const ir = {
      ...createTextDocumentIR({ filename: 'one-price-duration.hwp', sourceType: 'hwp', text, parserEngine: 'test', parserVersion: '1' }),
      tables,
    };

    const diagnosis = diagnoseDocumentIrTableProductSplit(ir);
    const segmented = segmentDocumentIR(ir, 'source-one-price-duration');

    expect(diagnosis.sharedTables[0]).toMatchObject({ priceColumns: [3], assignments: [3, 3] });
    expect(segmented.sections).toHaveLength(2);
    expect(segmented.sections[0]?.rawText).toContain('9월 9일');
    expect(segmented.sections[0]?.rawText).not.toContain('9월 5일');
    expect(segmented.sections[1]?.rawText).toContain('9월 5일');
    expect(segmented.sections[1]?.rawText).not.toContain('9월 9일');
  });

  it('keeps the flat product boundary when complete table and flat counts are equal', () => {
    const makeTable = (prefix: string, title: string, hotel: string) => {
      const rows = [
        [title, ''],
        ['포함 내역', '왕복항공료, 호텔'],
        ['불포함 내역', '개인경비'],
        ['일 자', '지 역', '교통편', '시간', '일 정', '식 사'],
        ['제1일', '부산', 'BX321', '10:30', '출발', '중식'],
        ['제2일', '현지', '전용차량', '전일', `${hotel} 투숙`, '호텔식'],
        ['제3일', '부산', 'BX322', '12:30', '도착', '조식'],
      ];
      const cells = rows.flatMap((values, row) => values.flatMap((text, column) => text ? [{
        id: `${prefix}-${row}-${column}`,
        nodeId: `${prefix}-node-${row}-${column}`,
        row,
        column,
        rowSpan: 1,
        colSpan: 1,
        text,
        evidence: { page: 0, quoteHash: `${prefix}-${row}-${column}` },
      }] : []));
      return { id: prefix, rows: rows.length, columns: 6, cells };
    };
    const first = makeTable('first', '[BX] 청도 실속 2박3일 일정표', '알파 호텔');
    const second = makeTable('second', '[BX] 청도 품격 2박3일 일정표', '베타 호텔');
    const tableText = (table: typeof first) => table.cells
      .sort((left, right) => left.row - right.row || left.column - right.column)
      .map(cell => cell.text)
      .join('\n');
    const text = [
      '출발일 실속 품격',
      '2027-09-01 349,000 569,000',
      tableText(first),
      tableText(second),
    ].join('\n');
    const ir = {
      ...createTextDocumentIR({
        filename: 'equal-boundaries.hwp', sourceType: 'hwp', text,
        parserEngine: 'test', parserVersion: '1',
      }),
      tables: [first, second],
    };

    const result = segmentDocumentIR(ir, 'source-equal-boundaries');

    expect(result.sections).toHaveLength(2);
    expect(result.segmentationSource).toBe('catalog-pre-split');
  });

  it('inherits one terminal commercial context block into every catalog product', () => {
    const catalog = createTextDocumentIR({
      filename: 'catalog.txt',
      sourceType: 'text',
      parserEngine: 'text-utf8',
      parserVersion: '1',
      text: [
        '공통 가격표',
        '2027-01-01 599,000원',
        '[ZE] 다낭 실속 3박5일 일정표',
        '제1일 부산 출발',
        '[BX] 다낭 골프 3박5일 일정표',
        '제1일 부산 출발',
        '포함 내역',
        '왕복 항공료, 숙박',
        '불포함 내역',
        '개인 경비',
        '취소 및 환불 규정',
        '출발 20일 전 취소 시 여행요금의 10% 공제',
      ].join('\n'),
    });
    const result = segmentDocumentIR(catalog, 'source-catalog');
    expect(result.sections).toHaveLength(2);
    for (const section of result.sections) {
      expect(section.rawText).toContain('왕복 항공료, 숙박');
      expect(section.rawText).toContain('개인 경비');
      expect(section.rawText).toContain('출발 20일 전 취소 시');
    }
  });

  it('does not mix repeated product-specific commercial blocks', () => {
    const catalog = createTextDocumentIR({
      filename: 'catalog.txt', sourceType: 'text', parserEngine: 'text-utf8', parserVersion: '1',
      text: [
        '[ZE] 다낭 실속 3박5일 일정표', '제1일 일정 A', '포함 내역', '상품 A 전용 포함',
        '[BX] 다낭 골프 3박5일 일정표', '제1일 일정 B', '포함 내역', '상품 B 전용 포함',
      ].join('\n'),
    });
    const result = segmentDocumentIR(catalog, 'source-specific');
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]?.rawText).not.toContain('상품 B 전용 포함');
    expect(result.sections[1]?.rawText).not.toContain('상품 A 전용 포함');
  });

  it('prefers a carrier-prefixed package heading over a minimum-traveler notice', () => {
    const catalog = createTextDocumentIR({
      filename: 'vn-catalog.txt',
      sourceType: 'text',
      parserEngine: 'text-utf8',
      parserVersion: '1',
      text: [
        '\uBD80\uC0B0-\uD558\uB178\uC774 VN\uBCA0\uD2B8\uB0A8\uD56D\uACF5',
        '[VN] \uBCA0\uD2B8\uB0A8 \uD558\uB178\uC774/\uD558\uB871 3\uBC155\uC77C \u2611\uC2E4\uC18D',
        '6\uBA85\uBD80\uD130 \uCD9C\uD655 / \uBBF8\uB2EC\uCD9C\uBC1C\uC2DC \uCD94\uAC00\uAE08\uC561 \uBC1C\uC0DD',
        '\uC81C1\uC77C \uBD80\uC0B0 \uCD9C\uBC1C',
        '[VN] \uBCA0\uD2B8\uB0A8 \uD558\uB178\uC774/\uC0AC\uD30C 3\uBC155\uC77C',
        '\u2605\uB7ED\uC154\uB9AC 5\uC131 \uD06C\uB8E8\uC988\uC219\uBC15\u2605 \u2611\uB178\uD301\uB178\uC635\uC158',
        '6\uBA85\uBD80\uD130 \uCD9C\uD655',
        '\uC81C1\uC77C \uBD80\uC0B0 \uCD9C\uBC1C',
      ].join('\n'),
    });

    const result = segmentDocumentIR(catalog, 'source-vn-catalog');

    expect(result.sections.map(section => section.titleHint)).toEqual([
      '[VN] \uBCA0\uD2B8\uB0A8 \uD558\uB178\uC774/\uD558\uB871 3\uBC155\uC77C \u2611\uC2E4\uC18D',
      '[VN] \uBCA0\uD2B8\uB0A8 \uD558\uB178\uC774/\uC0AC\uD30C 3\uBC155\uC77C \u2605\uB7ED\uC154\uB9AC 5\uC131 \uD06C\uB8E8\uC988\uC219\uBC15\u2605 \u2611\uB178\uD301\uB178\uC635\uC158',
    ]);
  });

  it('keeps the destination and duration when a grade PKG modifier wraps to the next line', () => {
    const catalog = createTextDocumentIR({
      filename: 'wrapped-grade-catalog.txt',
      sourceType: 'text',
      parserEngine: 'text-utf8',
      parserVersion: '1',
      text: [
        '부산출발 연길/백두산(북파) 2박3일 실속PKG',
        '포함 왕복항공료 호텔', '불포함 개인경비', '제1일 BX337 부산 출발', '제3일 부산 도착',
        '부산출발 연길/백두산(북파) 2박3일',
        '품격PKG (노팁+노옵션)',
        '포함 왕복항공료 호텔', '불포함 개인경비', '제1일 BX337 부산 출발', '제3일 부산 도착',
      ].join('\n'),
    });

    const result = segmentDocumentIR(catalog, 'source-wrapped-grade');

    expect(result.sections).toHaveLength(2);
    expect(result.sections[1]?.titleHint).toBe('부산출발 연길/백두산(북파) 2박3일 품격PKG (노팁+노옵션)');
  });

  it('uses a bracketed grade itinerary title instead of a minimum-departure label', () => {
    const catalog = createTextDocumentIR({
      filename: 'grade-title-catalog.txt', sourceType: 'text', parserEngine: 'text-utf8', parserVersion: '1',
      text: [
        '[실속] 서안, 병마용, 화청지 3박 5일', '최소출발', '성인 4명 이상', '제1일 부산 출발',
        '[품격] 서안(병마용,화청지), 화산 3박 5일', '최소출발', '성인 4명 이상', '제1일 부산 출발',
      ].join('\n'),
    });

    const result = segmentDocumentIR(catalog, 'source-grade-title');

    expect(result.sections.map(section => section.titleHint)).toEqual([
      '[실속] 서안, 병마용, 화청지 3박 5일',
      '[품격] 서안(병마용,화청지), 화산 3박 5일',
    ]);
  });

  it('keeps another grade footer out of local customer notices while preserving a shared ticketing deadline', async () => {
    const text = [
      '공통 가격표',
      '▶ 화산·품격 : 노팁, 노옵션, 노쇼핑',
      '★ 7월 30일(목)까지 항공권 발권하는 조건입니다.',
      '[실속] 서안, 병마용, 화청지 3박 5일',
      '출발일 2026-09-02', '판매가 549,000원', '최소출발 성인 4명 이상',
      '포함 내역', '항공료, 숙박, 차량, 한국어 가이드',
      '불포함 내역', '기사/가이드경비 $50/인, 개인경비',
      '선택관광', '화산 케이블카 $120', '쇼핑센터', '라텍스 총3회',
      '제1일 BX341 부산 출발 21:55 서안 도착 00:35', '제2일 서안 관광', '제3일 서안 관광', '제4일 서안 관광', '제5일 BX342 부산 도착',
      '[품격] 서안(병마용,화청지), 화산 3박 5일',
      '출발일 2026-09-02', '판매가 1,069,000원', '최소출발 성인 4명 이상',
      '포함 내역', '항공료, 숙박, 기사/가이드 경비', '불포함 내역', '개인경비',
      '선택관광', '노옵션', '쇼핑센터', '노쇼핑',
      '제1일 BX341 부산 출발 21:55 서안 도착 00:35', '제2일 화산 관광', '제3일 서안 관광', '제4일 서안 관광', '제5일 BX342 부산 도착',
    ].join('\n');
    const catalog = createTextDocumentIR({
      filename: '26년 서안 등급 상품.txt', sourceType: 'text', parserEngine: 'text-utf8', parserVersion: '1', text,
    });

    const normalized = await buildCanonicalNormalization({
      documentIr: catalog,
      sourceDocumentId: 'source-grade-notice-isolation',
      extractionId: 'extract-grade-notice-isolation',
      departureDateReference: { referenceDate: '2026-08-16', rollingInferenceEligible: true },
    });
    const sections = normalized.canonicalPayload.sections as Array<Record<string, any>>;
    const first = sections[0]!.v3.ledger.variants[0];
    const second = sections[1]!.v3.ledger.variants[0];

    expect(sections[0]!.titleHint).toBe('[실속] 서안, 병마용, 화청지 3박 5일');
    expect(first.standard_notices.map((notice: Record<string, unknown>) => notice.template_key)).not.toContain('guide.tip_included');
    expect(first.standard_notices.map((notice: Record<string, unknown>) => notice.template_key)).not.toContain('optional.none');
    expect(first.standard_notices.map((notice: Record<string, unknown>) => notice.template_key)).not.toContain('shopping.none');
    expect(first.ticketing_condition).toMatchObject({ deadline: '2026-07-30', status: 'expired' });
    expect(second.standard_notices.map((notice: Record<string, unknown>) => notice.template_key)).toContain('optional.none');
    expect(second.standard_notices.map((notice: Record<string, unknown>) => notice.template_key)).toContain('shopping.none');
  });

  it('prefers a plain carrier product title over a later travel notice', () => {
    const catalog = createTextDocumentIR({
      filename: 'plain-carrier-grade-catalog.txt',
      sourceType: 'text',
      parserEngine: 'text-utf8',
      parserVersion: '1',
      text: [
        '★高품격★',
        'BX 장가계 3박4일',
        '여행기간 2026년 8월',
        '중국 입국하는 한국 관광객 대상으로 여행 목적 입국 시 무비자 체류 가능',
        '포함 항공 호텔', '불포함 개인경비', '제1일 BX371 부산 출발', '제4일 부산 도착',
        '★LUXURY★',
        'BX 장가계+부용진 3박4일',
        '여행기간 2026년 8월',
        '중국 입국하는 한국 관광객 대상으로 여행 목적 입국 시 무비자 체류 가능',
        '포함 항공 호텔', '불포함 개인경비', '제1일 BX371 부산 출발', '제4일 부산 도착',
      ].join('\n'),
    });

    const result = segmentDocumentIR(catalog, 'source-plain-carrier');

    expect(result.sections.map(section => section.titleHint)).toEqual([
      'BX 장가계 3박4일',
      'BX 장가계+부용진 3박4일',
    ]);
  });

  it('produces a lineage-bound canonical payload without writing customer data', async () => {
    const normalized = await buildCanonicalNormalization({
      documentIr,
      sourceDocumentId: 'source-1',
      extractionId: 'extraction-1',
    });
    expect(normalized.version).toBe('v6-canonical-2026-08-18.58');
    expect(normalized.sourceDocumentId).toBe('source-1');
    expect(normalized.canonicalPayload.sections).toHaveLength(1);
    expect(normalized.qualityDiagnostics.sectionCount).toBe(1);
    expect(['complete', 'needs_review']).toContain(normalized.status);
  });

  it('turns explicit duration price rows into separate canonical product variants', async () => {
    const rows = [
      ['349,000', '[3박5일] 5/20'],
      ['399,000', '[4박6일] 5/2, 5/3, 5/9'],
    ];
    const cells = rows.flatMap((values, row) => values.map((text, column) => ({
      id: `axis-cell-${row}-${column}`,
      nodeId: `axis-node-${row}-${column}`,
      row,
      column,
      rowSpan: 1,
      colSpan: 1,
      text,
      evidence: { page: 0, quoteHash: `axis-${row}-${column}` },
    })));
    const text = [
      '2027년 보홀 상품',
      ...cells.map(cell => cell.text),
      '포함 왕복 항공료 숙박 식사',
      '불포함 개인경비 싱글차지',
      '취소 및 환불 규정 안내',
    ].join('\n');
    const withTable = {
      ...createTextDocumentIR({
        filename: 'bohol-duration.hwp', sourceType: 'hwp', text,
        parserEngine: 'test', parserVersion: '1',
      }),
      tables: [{ id: 'axis-table', page: 0, rows: 2, columns: 2, cells }],
    };

    const normalized = await buildCanonicalNormalization({
      documentIr: withTable,
      sourceDocumentId: 'source-axis',
      extractionId: 'extraction-axis',
    });
    const section = normalized.canonicalPayload.sections[0] as Record<string, any>;
    const variants = section.v3.ledger.variants;

    expect(variants).toHaveLength(2);
    expect(variants.map((variant: Record<string, any>) => [
      variant.duration_days,
      variant.price_calendar.map((price: Record<string, any>) => [price.date, price.amount]),
    ])).toEqual([
      [5, [['2027-05-20', 349_000]]],
      [6, [['2027-05-02', 399_000], ['2027-05-03', 399_000], ['2027-05-09', 399_000]]],
    ]);
  });

  it('keeps one local catalog product and replays only one unambiguous non-deposit duration price', () => {
    const price = {
      date: '2026-09-02', date_range: null, weekday: null, label: '9/2',
      amount: 1_159_000, currency: 'KRW', list_price: null,
      evidence: { line_start: 1, line_end: 1, char_start: 0, char_end: 9, quote: '1,159,000원' },
    };
    const shared = {
      variant_key: 'shared', course: '월/수 4박6일', duration_days: 6, nights: 4,
      title_parts: ['월/수 4박6일'], price_calendar: [price], days: [], flight_segments: [],
      inclusions: [], exclusions: [], evidence_coverage: { price: true },
    } as any;
    const local = {
      ...shared,
      variant_key: 'local',
      course: '[BX] 부산 - 발리 4박 6일',
      title_parts: ['[BX] 부산 - 발리 4박 6일'],
      price_calendar: [],
      evidence_coverage: { price: false },
    } as any;

    const result = reconcileCatalogPreSplitLocalVariant({
      variants: [shared, local],
      sectionRawText: '공통 가격표\n\n---\n\n[BX] 부산 - 발리 4박 6일\nDAY 1 부산 출발',
      durationDays: 6,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.variant_key).toBe('local');
    expect(result[0]?.price_calendar).toEqual([price]);
  });

  it('does not copy a reservation deposit into a local product sale price', () => {
    const deposit = {
      date: '2026-09-02', date_range: null, weekday: null, label: '9/2',
      amount: 300_000, currency: 'KRW', list_price: null,
      evidence: { line_start: 1, line_end: 1, char_start: 0, char_end: 20, quote: '예약금 300,000원 입금' },
    };
    const shared = {
      variant_key: 'shared', course: '4박6일 공통', duration_days: 6, nights: 4,
      title_parts: ['4박6일 공통'], price_calendar: [deposit], days: [], flight_segments: [],
      inclusions: [], exclusions: [], evidence_coverage: { price: true },
    } as any;
    const local = {
      ...shared,
      variant_key: 'local',
      course: '[BX] 현지 상품 4박 6일',
      title_parts: ['[BX] 현지 상품 4박 6일'],
      price_calendar: [],
      evidence_coverage: { price: false },
    } as any;

    const result = reconcileCatalogPreSplitLocalVariant({
      variants: [shared, local],
      sectionRawText: '공통 안내\n\n---\n\n[BX] 현지 상품 4박 6일\nDAY 1 출발',
      durationDays: 6,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.variant_key).toBe('local');
    expect(result[0]?.price_calendar).toEqual([]);
  });

  it('validates the departure year per product section instead of conflicting across a catalog', async () => {
    const catalog = createTextDocumentIR({
      filename: 'supplier-catalog.txt',
      sourceType: 'text',
      parserEngine: 'text-utf8',
      parserVersion: '1',
      text: [
        '\uC0C1\uD488: [ZE] \uB2E4\uB0AD 3\uBC155\uC77C',
        '\uCD9C\uBC1C\uC77C 2026-10-01 599,000\uC6D0',
        'DAY 1 ZE123 10:00 13:00',
        '\uD3EC\uD568 \uD56D\uACF5\uB8CC \uD638\uD154 \uC2DD\uC0AC',
        '\uBD88\uD3EC\uD568 \uAC1C\uC778\uACBD\uBE44 \uC2F1\uAE00\uCC28\uC9C0',
        '\uC0C1\uD488: [BX] \uB2E4\uB0AD 3\uBC155\uC77C',
        '\uCD9C\uBC1C\uC77C 2027-01-01 699,000\uC6D0',
        'DAY 1 BX123 10:00 13:00',
        '\uD3EC\uD568 \uD56D\uACF5\uB8CC \uD638\uD154 \uC2DD\uC0AC',
        '\uBD88\uD3EC\uD568 \uAC1C\uC778\uACBD\uBE44 \uC2F1\uAE00\uCC28\uC9C0',
      ].join('\n'),
    });
    const normalized = await buildCanonicalNormalization({
      documentIr: catalog,
      sourceDocumentId: 'source-years',
      extractionId: 'extraction-years',
    });

    expect(normalized.canonicalPayload.sections).toHaveLength(2);
    expect(normalized.canonicalPayload.sections.map(section => section.priceYearEvidence)).toEqual([
      { validated: true, year: 2026, source: 'document_text' },
      { validated: true, year: 2027, source: 'document_text' },
    ]);
  });

  it('resolves an omitted departure year to the nearest non-past Korea date', async () => {
    const yearless = createTextDocumentIR({
      filename: '다낭-일정표.txt',
      sourceType: 'text',
      parserEngine: 'text-utf8',
      parserVersion: '1',
      text: [
        '상품: 다낭 3박5일',
        '출발일 9/20 599,000원',
        'DAY 1 BX321 19:00 22:00',
        '포함 항공료 호텔 식사',
        '불포함 개인경비 싱글차지',
        '취소 및 환불 규정 안내',
      ].join('\n'),
    });
    const normalized = await buildCanonicalNormalization({
      documentIr: yearless,
      sourceDocumentId: 'source-yearless',
      extractionId: 'extraction-yearless',
      departureDateReference: {
        referenceDate: '2026-08-14',
        rollingInferenceEligible: true,
      },
    });
    const section = normalized.canonicalPayload.sections[0] as Record<string, any>;
    expect(section.priceYearEvidence).toMatchObject({
      validated: true,
      year: 2026,
      source: 'nearest_future_policy',
      referenceDate: '2026-08-14',
    });
    expect(section.departureDatePolicy).toMatchObject({
      referenceDate: '2026-08-14',
      disposition: 'eligible_future',
      inferredDateCount: 1,
      excludedPastDateCount: 0,
    });
    expect(section.v3.ledger.variants[0].price_calendar[0]).toMatchObject({
      date: '2026-09-20',
      date_resolution: {
        authority: 'nearest_future_policy',
        reference_date: '2026-08-14',
      },
    });
  });

  it('binds a source-title shorthand sale price to exact leading filename departures', async () => {
    const source = createTextDocumentIR({
      filename: '[BX전세기] 0711, 18 장가계 3박4일 노노 499 특가 - 컴 9%.hwp',
      sourceType: 'hwp',
      parserEngine: 'test',
      parserVersion: '1',
      text: [
        '장가계 노팁 노옵션 499 특가',
        '2026년 행사',
        'DAY 1 BX371 09:00 11:20',
        '포함 항공료 호텔 식사 가이드',
        '불포함 개인경비 싱글차지',
        '취소 및 환불 규정 안내',
      ].join('\n'),
    });
    const normalized = await buildCanonicalNormalization({
      documentIr: source,
      sourceDocumentId: 'source-title-shorthand',
      extractionId: 'extraction-title-shorthand',
      departureDateReference: { referenceDate: '2026-07-01', rollingInferenceEligible: true },
    });
    const section = normalized.canonicalPayload.sections[0] as Record<string, any>;

    expect(section.titleSalePriceSeed).toMatchObject({ applied: true, amount: 499_000, sourceToken: '499' });
    expect(section.filenamePriceBinding).toMatchObject({
      applied: true,
      dates: ['2026-07-11', '2026-07-18'],
      amount: 499_000,
    });
    expect(section.v3.ledger.variants[0].price_calendar).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-07-11', amount: 499_000 }),
      expect.objectContaining({ date: '2026-07-18', amount: 499_000 }),
    ]));
  });

  it('removes explicitly past departures instead of rolling them into a later year', async () => {
    const past = createTextDocumentIR({
      filename: '과거-일정표.txt',
      sourceType: 'text',
      parserEngine: 'text-utf8',
      parserVersion: '1',
      text: [
        '상품: 다낭 3박5일',
        '출발일 2026-01-10 599,000원',
        'DAY 1 BX321 19:00 22:00',
        '포함 항공료 호텔 식사',
        '불포함 개인경비 싱글차지',
        '취소 및 환불 규정 안내',
      ].join('\n'),
    });
    const normalized = await buildCanonicalNormalization({
      documentIr: past,
      sourceDocumentId: 'source-past',
      extractionId: 'extraction-past',
      departureDateReference: {
        referenceDate: '2026-08-14',
        rollingInferenceEligible: true,
      },
    });
    const section = normalized.canonicalPayload.sections[0] as Record<string, any>;
    expect(section.departureDatePolicy).toMatchObject({
      disposition: 'past_only_excluded',
      excludedPastDateCount: 1,
      futureDatedEntryCount: 0,
    });
    expect(section.v3.ledger.variants[0].price_calendar).toEqual([]);
  });

  it('safely excludes a source whose trusted filename month window has fully expired', async () => {
    const expired = createTextDocumentIR({
      filename: '[BX] 마쓰야마 관광PKG 26년3-7월 0227.hwp',
      sourceType: 'hwp',
      parserEngine: 'test',
      parserVersion: '1',
      text: [
        '상품: 마쓰야마 2박3일',
        '요금표 참고',
        'DAY 1 BX123 09:00 11:00',
        '포함 항공료 호텔 식사',
        '불포함 개인경비 싱글차지',
      ].join('\n'),
    });
    const normalized = await buildCanonicalNormalization({
      documentIr: expired,
      sourceDocumentId: 'source-expired-month-window',
      extractionId: 'extraction-expired-month-window',
      departureDateReference: { referenceDate: '2026-08-15', rollingInferenceEligible: true },
    });
    const section = normalized.canonicalPayload.sections[0] as Record<string, any>;

    expect(section.departureDatePolicy).toMatchObject({
      disposition: 'past_only_excluded',
      sourceProvesSectionExpired: true,
      trustedFilenameMonthWindow: {
        start: '2026-03-01',
        end: '2026-07-31',
      },
    });
  });

  it('safely excludes a source whose explicit compact departure window has fully expired', async () => {
    const expired = createTextDocumentIR({
      filename: '\uACC4\uB9BC \uC77C\uC815\uD45C.hwp',
      sourceType: 'hwp',
      parserEngine: 'test',
      parserVersion: '1',
      text: [
        '\uACC4\uB9BC 3\uBC155\uC77C',
        '\uCD9C \uBC1C \uC77C',
        '2026\uB144 4/3~5/26 (\uD654\uC694\uC77C)',
        '\uC0C1\uD488\uAC00 1,099,000\uC6D0',
        'DAY 1 LJ123 09:00 11:00',
        '\uD3EC\uD568 \uD56D\uACF5\uB8CC \uD638\uD154 \uC2DD\uC0AC',
        '\uBD88\uD3EC\uD568 \uAC1C\uC778\uACBD\uBE44 \uC2F1\uAE00\uCC28\uC9C0',
      ].join('\n'),
    });
    const normalized = await buildCanonicalNormalization({
      documentIr: expired,
      sourceDocumentId: 'source-expired-compact-window',
      extractionId: 'extraction-expired-compact-window',
      departureDateReference: { referenceDate: '2026-08-16', rollingInferenceEligible: true },
    });
    const section = normalized.canonicalPayload.sections[0] as Record<string, any>;

    expect(section.departureDatePolicy).toMatchObject({
      disposition: 'past_only_excluded',
      sourceProvesSectionExpired: true,
      explicitSourceWindow: {
        start: '2026-04-03',
        end: '2026-05-26',
      },
    });
  });

  it('accepts a valid YYMMDD departure token in the source filename as year evidence', async () => {
    const compactDateSource = createTextDocumentIR({
      filename: '[\uCD9C\uBC1C] 260417 \uD669\uC0B0 4\uBC155\uC77C.hwp',
      sourceType: 'text',
      parserEngine: 'text-utf8',
      parserVersion: '1',
      text: '\uC0C1\uD488: \uD669\uC0B0 4\uBC155\uC77C\n4/17 999,000\uC6D0',
    });
    const normalized = await buildCanonicalNormalization({
      documentIr: compactDateSource,
      sourceDocumentId: 'source-compact-year',
      extractionId: 'extraction-compact-year',
    });

    expect(normalized.canonicalPayload.sections[0]?.priceYearEvidence).toEqual({
      validated: true,
      year: 2026,
      source: 'filename',
    });
  });

  it('binds one final sale price to one trusted compact departure date in a single-product filename', async () => {
    const source = createTextDocumentIR({
      filename: '[일정표] LJ 부산출발 푸꾸옥 260730 - 특가 (0716).hwp',
      sourceType: 'hwp',
      parserEngine: 'test',
      parserVersion: '1',
      text: [
        '푸꾸옥 3박5일 패키지',
        '1인 1,199,000원→1,039,000원',
        '포함사항 왕복항공료, 호텔',
        '불포함사항 개인경비',
        '제1일 부산 출발',
        '제2일 푸꾸옥 관광',
        '제3일 자유일정',
        '제4일 푸꾸옥 출발',
        '제5일 부산 도착',
        '취소규정 국외여행 표준약관 적용',
      ].join('\n'),
    });
    const result = await buildCanonicalNormalization({
      documentIr: source,
      sourceDocumentId: 'source-filename-price-binding',
      extractionId: 'extract-filename-price-binding',
      departureDateReference: { referenceDate: '2026-01-01', rollingInferenceEligible: true },
    });
    const section = result.canonicalPayload.sections[0] as any;
    expect(section.priceYearEvidence).toEqual(expect.objectContaining({ validated: true, year: 2026, source: 'filename' }));
    expect(section.filenamePriceBinding).toEqual(expect.objectContaining({ applied: true, dates: ['2026-07-30'], amount: 1_039_000 }));
    expect(section.v3.ledger.variants[0].price_calendar).toEqual([
      expect.objectContaining({ date: '2026-07-30', amount: 1_039_000, list_price: 1_199_000 }),
    ]);
  });

  it('binds every evidence-backed party-size tier to one trusted filename departure date', async () => {
    const source = createTextDocumentIR({
      filename: '[인천출발]인도 원데이특가(9월27일)인도 베스트 5박7일.hwp',
      sourceType: 'hwp',
      parserEngine: 'test',
      parserVersion: '1',
      text: [
        '인도 베스트 5박7일',
        '상품가',
        '1,890,000원',
        '📌 7인 이상 출발 시 : 1,790,000원(10만원 추가 할인)',
        '📌 10인 이상 출발 시 : 1,690,000원(20만원 추가 할인)',
        '포함사항 왕복항공료, 호텔, 일정상 식사',
        '불포함사항 개인경비, 싱글차지',
        '제1일 인천 출발',
        '제2일 델리 관광',
        '제3일 자이푸르 관광',
        '제4일 아그라 관광',
        '제5일 델리 이동',
        '제6일 델리 출발',
        '제7일 인천 도착',
        '취소규정 국외여행 표준약관 적용',
      ].join('\n'),
    });
    const result = await buildCanonicalNormalization({
      documentIr: source,
      sourceDocumentId: 'source-filename-party-tier-binding',
      extractionId: 'extract-filename-party-tier-binding',
      departureDateReference: { referenceDate: '2026-08-14', rollingInferenceEligible: true },
    });
    const section = result.canonicalPayload.sections[0] as any;
    expect(section.filenamePriceBinding).toEqual(expect.objectContaining({
      applied: true,
      dates: ['2026-09-27'],
      amount: null,
      amounts: [1_690_000, 1_790_000, 1_890_000],
    }));
    expect(section.v3.ledger.variants[0].price_calendar).toEqual([
      expect.objectContaining({ date: '2026-09-27', amount: 1_890_000, min_travelers: null }),
      expect.objectContaining({ date: '2026-09-27', amount: 1_790_000, min_travelers: 7 }),
      expect.objectContaining({ date: '2026-09-27', amount: 1_690_000, min_travelers: 10 }),
    ]);
  });

  it('uses an authenticated upload-envelope year only when source text and filenames omit it', async () => {
    const source = createTextDocumentIR({
      filename: '[출발] 황산 4박5일.hwp',
      sourceType: 'text',
      parserEngine: 'text-utf8',
      parserVersion: '1',
      text: [
        '상품: 황산 4박5일',
        '출발일',
        '4/17',
        '기간',
        '1인 999,000원',
        '상품가',
        'DAY 1 부산 출발',
        '포함 항공료 호텔 식사',
        '불포함 개인경비 싱글차지',
      ].join('\n'),
    });
    const normalized = await buildCanonicalNormalization({
      documentIr: source,
      sourceDocumentId: 'source-upload-envelope-year',
      extractionId: 'extraction-upload-envelope-year',
      sourceDepartureYearContext: {
        year: 2026,
        authority: 'authenticated_admin',
        version: 'source-departure-year-context-1',
      },
    });

    expect(normalized.canonicalPayload.sections[0]?.priceYearEvidence).toEqual({
      validated: true,
      year: 2026,
      source: 'upload_envelope',
      authority: 'authenticated_admin',
      contextVersion: 'source-departure-year-context-1',
    });
    const section = normalized.canonicalPayload.sections[0] as {
      v3?: { ledger?: { variants?: Array<{ price_calendar?: Array<{ date?: string | null }> }> } };
    };
    const parsedDates = section.v3?.ledger?.variants
      ?.flatMap(variant => variant.price_calendar ?? [])
      .map(price => price.date)
      .filter(Boolean) ?? [];
    expect(parsedDates).toContain('2026-04-17');
  });

  it('does not let the upload envelope override an explicit source year', async () => {
    const source = createTextDocumentIR({
      filename: '[출발] 2027년 황산 4박5일.hwp',
      sourceType: 'text',
      parserEngine: 'text-utf8',
      parserVersion: '1',
      text: '상품: 황산 4박5일\n4/17 999,000원',
    });
    const normalized = await buildCanonicalNormalization({
      documentIr: source,
      sourceDocumentId: 'source-explicit-year-wins',
      extractionId: 'extraction-explicit-year-wins',
      sourceDepartureYearContext: {
        year: 2026,
        authority: 'authenticated_admin',
        version: 'source-departure-year-context-1',
      },
    });

    expect(normalized.canonicalPayload.sections[0]?.priceYearEvidence).toEqual({
      validated: true,
      year: 2027,
      source: 'filename',
    });
  });

  it('uses only approved bundle member filenames as source year evidence', async () => {
    const merged = mergeSourceBundleDocumentIR({
      bundleHash: 'f'.repeat(64),
      members: [{
        sourceDocumentId: 'price-source', extractionId: 'price-extraction', sourceHash: 'a'.repeat(64), role: 'price_sheet',
        documentIr: createTextDocumentIR({
          filename: '[요금표] 260417 황산 4박5일.hwp', sourceType: 'hwp', parserEngine: 'test', parserVersion: '1',
          text: '4/17 999,000원',
        }),
      }, {
        sourceDocumentId: 'itinerary-source', extractionId: 'itinerary-extraction', sourceHash: 'b'.repeat(64), role: 'itinerary_sheet',
        documentIr: createTextDocumentIR({
          filename: '[일정표] 황산 4박5일.hwp', sourceType: 'hwp', parserEngine: 'test', parserVersion: '1',
          text: 'DAY 1 부산 출발\nDAY 2 황산 관광',
        }),
      }],
    });
    const normalized = await buildCanonicalNormalization({
      documentIr: merged,
      sourceDocumentId: 'bundle-primary',
      extractionId: 'bundle-extraction',
    });
    expect(normalized.canonicalPayload.sections[0]?.priceYearEvidence).toEqual({
      validated: true,
      year: 2026,
      source: 'filename',
    });
  });

  it('does not report an active V6 review workflow as a failed legacy job', () => {
    expect(canonicalNormalizationJobStatus({ normalizationStatus: 'needs_review', workflowEnabled: true })).toBe('processing');
    expect(canonicalNormalizationJobStatus({ normalizationStatus: 'needs_review', workflowEnabled: false })).toBe('failed');
  });

  it('binds a legacy package to one local catalog section without using shared-prefix titles as facts', () => {
    const sections: CanonicalSection[] = [
      {
        index: 0,
        sectionKey: 'source:0',
        titleHint: '공통 판매 안내',
        rawText: '마카오/홍콩 2박4일\n마카오+1일자유 2박4일\n\n---\n\n마카오/홍콩 2박4일\n전일 관광',
        rawTextHash: 'a', sourceNodeIds: [], evidence: [],
      },
      {
        index: 1,
        sectionKey: 'source:1',
        titleHint: '공통 판매 안내',
        rawText: '마카오/홍콩 2박4일\n마카오+1일자유 2박4일\n\n---\n\n마카오+1일자유 2박4일\n자유 일정',
        rawTextHash: 'b', sourceNodeIds: [], evidence: [],
      },
    ];
    expect(selectCanonicalSectionForIdentity(sections, { title: '마카오+1일자유 2박4일' })?.index).toBe(1);
  });

  it('keeps an indistinguishable legacy package identity blocked', () => {
    const sections: CanonicalSection[] = [0, 1].map(index => ({
      index,
      sectionKey: `source:${index}`,
      titleHint: '공통 안내',
      rawText: `모든 상품 공통 제목\n\n---\n\n${index + 1}일차 관광`,
      rawTextHash: String(index),
      sourceNodeIds: [],
      evidence: [],
    }));
    expect(selectCanonicalSectionForIdentity(sections, { title: '구분할 수 없는 상품' })).toBeNull();
  });

  it('hands only revision-bound sections and payloads to downstream policy', () => {
    const sections: CanonicalSection[] = [0, 1].map(index => ({
      index,
      sectionKey: `source:${index}`,
      titleHint: `상품 ${index}`,
      rawText: `상품 ${index} 원문`,
      rawTextHash: `hash-${index}`,
      sourceNodeIds: [],
      evidence: [],
    }));
    const normalization = {
      version: 'v6-canonical-2026-08-18.58' as const,
      sourceDocumentId: 'source', extractionId: 'extraction', rawTextHash: 'full', sections,
      canonicalPayload: { sections: [{ index: 0 }, { index: 1 }] },
      lineage: { attractionMasterHash: null },
      qualityDiagnostics: {
        sectionCount: 2, normalizedSectionCount: 2, blockedSectionCount: 0,
        segmentationSource: 'catalog-pre-split' as const, gateStatuses: ['blocked', 'ready_to_publish'],
        completeness: {
          confirmedCount: 0, pendingSupplierCount: 0, conflictingCount: 0, unavailableCount: 0,
          publicReadySectionCount: 1, verifiedSectionCount: 1, degradedSectionCount: 0,
          blockedSectionCount: 1, degradedReasons: [], blockers: [], fields: [],
        },
        departureDatePolicy: {
          referenceDate: null,
          policyVersion: null,
          inferredDateCount: 0,
          explicitDateCount: 0,
          excludedPastDateCount: 0,
          futureDepartureCount: 0,
          pastOnlySectionIndexes: [],
          blockers: [],
        },
      },
      status: 'needs_review' as const,
    };
    const sliced = sliceCanonicalNormalizationForRevisionSections(normalization, [1]);
    expect(sliced.sections.map(section => section.index)).toEqual([1]);
    expect(sliced.canonicalPayload.sections).toEqual([{ index: 1 }]);
    expect(sliced.qualityDiagnostics.gateStatuses).toEqual(['ready_to_publish']);
  });

  it('persists every explicit hotel-duration-price variant as its own immutable product revision', () => {
    const section: CanonicalSection = {
      index: 0,
      sectionKey: 'source:0',
      titleHint: '보홀 호텔별 상품',
      rawText: '헤난 타왈라 3박5일 / 헤난 프리미어코스트 4박6일',
      rawTextHash: 'source-hash',
      sourceNodeIds: [],
      evidence: [],
    };
    const variants = [
      { variant_key: '타왈라|3박5일' },
      { variant_key: '타왈라|4박6일' },
      { variant_key: '프리미어코스트|3박5일' },
      { variant_key: '프리미어코스트|4박6일' },
    ];
    const normalization = {
      version: 'v6-canonical-2026-08-18.58' as const,
      sourceDocumentId: 'source', extractionId: 'extraction', rawTextHash: 'full', sections: [section],
      canonicalPayload: {
        sections: [{ v3: { ledger: { document: { expected_products: 4 }, variants } } }],
        lineage: { attractionMasterHash: null },
      },
      lineage: { attractionMasterHash: null },
      qualityDiagnostics: {
        sectionCount: 1, normalizedSectionCount: 1, blockedSectionCount: 0,
        segmentationSource: 'single-document' as const, gateStatuses: ['ready_to_publish'],
        completeness: {
          confirmedCount: 0, pendingSupplierCount: 0, conflictingCount: 0, unavailableCount: 0,
          publicReadySectionCount: 1, verifiedSectionCount: 1, degradedSectionCount: 0,
          blockedSectionCount: 0, degradedReasons: [], blockers: [], fields: [],
        },
        departureDatePolicy: {
          referenceDate: null, policyVersion: null, inferredDateCount: 0, explicitDateCount: 0,
          excludedPastDateCount: 0, futureDepartureCount: 0, pastOnlySectionIndexes: [], blockers: [],
        },
      },
      status: 'complete' as const,
    };

    const slices = buildCanonicalRevisionSlices(normalization, [section]);
    expect(slices).toHaveLength(4);
    expect(new Set(slices.map(slice => slice.productKeySuffix)).size).toBe(4);
    expect(slices.map(slice => {
      const payloadSection = slice.canonicalPayload.sections[0] as {
        v3: { ledger: { document: { expected_products: number }; variants: unknown[] } };
      };
      return [payloadSection.v3.ledger.document.expected_products, payloadSection.v3.ledger.variants.length];
    })).toEqual([[1, 1], [1, 1], [1, 1], [1, 1]]);
  });

  it('links one unambiguous price-only section to the matching itinerary section', () => {
    const sections = [
      {
        index: 0,
        sectionKey: 'price',
        destinationHint: '오사카/고베',
        v3: { ledger: { variants: [{ duration_days: 4, days: [], price_calendar: [
          { date: '2026-09-01', amount: 969000, evidence: { quote: '969,000' } },
        ] }] } },
      },
      {
        index: 1,
        sectionKey: 'itinerary',
        destinationHint: '오사카/고베',
        v3: { ledger: { variants: [{ duration_days: 4, days: [{ day: 1 }], flight_segments: [{ code: 'BX126' }], price_calendar: [] }] } },
      },
    ] as any[];

    expect(linkSharedPriceCalendarsAcrossSections(sections)).toEqual([1]);
    expect(sections[1]!.v3.ledger.variants[0].price_calendar).toEqual([
      expect.objectContaining({ date: '2026-09-01', amount: 969000 }),
    ]);
    expect(sections[1]!.v3.ledger.variants[0].evidence_coverage.price).toBe(true);
  });

  it('does not link when two same-destination price sections are ambiguous', () => {
    const sections = [
      { destinationHint: '오사카', v3: { ledger: { variants: [{ duration_days: 4, days: [], price_calendar: [{ amount: 900000 }] }] } } },
      { destinationHint: '오사카', v3: { ledger: { variants: [{ duration_days: 4, days: [], price_calendar: [{ amount: 950000 }] }] } } },
      { destinationHint: '오사카', v3: { ledger: { variants: [{ duration_days: 4, days: [{ day: 1 }], price_calendar: [] }] } } },
    ] as any[];
    expect(linkSharedPriceCalendarsAcrossSections(sections)).toEqual([]);
    expect(sections[2]!.v3.ledger.variants[0].price_calendar).toEqual([]);
  });

  it('links one shared date scope to a sibling hotel scalar price without copying the amount', () => {
    const evidence = (quote: string) => ({ line_start: 1, line_end: 1, char_start: 0, char_end: quote.length, quote });
    const variants = [
      {
        variant_key: ' 실속',
        duration_days: 5,
        price_calendar: [{ date: '2026-09-17', date_range: null, weekday: null, label: '9/17', amount: 679000, currency: 'KRW', evidence: evidence('679,000원') }],
        evidence_coverage: { price: true },
      },
      {
        variant_key: ' 고품격',
        duration_days: 5,
        price_calendar: [{ date: null, date_range: null, weekday: null, label: '969,000원', amount: 969000, currency: 'KRW', evidence: evidence('969,000원') }],
        evidence_coverage: { price: true },
      },
    ] as any;

    expect(linkSharedDateScopesAcrossVariants({
      variants,
      sectionRawText: '2026년 9월 17일 ~ 21일 [3박5일]',
    })).toBe(1);
    expect(variants[1].price_calendar).toEqual([
      expect.objectContaining({ date: '2026-09-17', amount: 969000 }),
    ]);
  });

  it('does not link sibling scalar prices when multiple date calendars exist', () => {
    const evidence = (quote: string) => ({ line_start: 1, line_end: 1, char_start: 0, char_end: quote.length, quote });
    const variants = [
      {
        duration_days: 5,
        price_calendar: [
          { date: '2026-09-17', date_range: null, weekday: null, label: '9/17', amount: 679000, currency: 'KRW', evidence: evidence('679,000원') },
          { date: '2026-09-24', date_range: null, weekday: null, label: '9/24', amount: 689000, currency: 'KRW', evidence: evidence('689,000원') },
        ],
      },
      {
        duration_days: 5,
        price_calendar: [{ date: '2026-10-01', date_range: null, weekday: null, label: '10/1', amount: 699000, currency: 'KRW', evidence: evidence('699,000원') }],
      },
      {
        duration_days: 5,
        price_calendar: [{ date: null, date_range: null, weekday: null, label: '969,000원', amount: 969000, currency: 'KRW', evidence: evidence('969,000원') }],
      },
    ] as any;

    expect(linkSharedDateScopesAcrossVariants({
      variants,
      sectionRawText: '2026년 9월 17일 ~ 10월 1일 [3박5일]',
    })).toBe(0);
    expect(variants[2].price_calendar[0].date).toBeNull();
  });
});
