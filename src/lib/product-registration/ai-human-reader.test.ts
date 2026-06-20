import { describe, expect, it } from 'vitest';
import { readSupplierDocumentLikeHuman } from './ai-human-reader';

const RAW_PRICE_TABLE = `
[Kyushu Fukuoka 2N3D]
상품가
7/1, 6, 8, 13, 15
1,299,000원
7/20, 22, 27, 29
1,399,000원
8/3, 5
1,499,000원
포함 내역
항공권
`;

describe('readSupplierDocumentLikeHuman', () => {
  it('keeps source-backed price/date pairs with evidence spans', () => {
    const result = readSupplierDocumentLikeHuman({
      rawText: RAW_PRICE_TABLE,
      title: 'Kyushu Fukuoka 2N3D',
      durationDays: 3,
      year: 2026,
    });

    expect(result.source).toBe('deterministic_evidence_reader');
    expect(result.priceSource).toBe('product_price_vertical_date_table');
    expect(result.pricePairs.length).toBeGreaterThanOrEqual(11);
    expect(result.pricePairs.find(row => row.date === '2026-07-01')?.adult_price).toBe(1299000);
    expect(result.evidenceSpans.some(span => span.field === 'human_reader.price_pair')).toBe(true);
    expect(result.uncertainties).not.toContain('no source-backed product price/date pairs recognized by evidence reader');
  });

  it('recognizes compact supplier date lines followed by one price line', () => {
    const result = readSupplierDocumentLikeHuman({
      rawText: [
        'PKG',
        '7/4,18 8/22(토)',
        '1,049,000원',
        '*선착순 10석, 6/10선발',
      ].join('\n'),
      durationDays: 6,
      year: 2026,
    });

    expect(result.pricePairs.map(row => `${row.date}:${row.adult_price}`)).toEqual(
      expect.arrayContaining([
        '2026-07-04:1049000',
        '2026-07-18:1049000',
        '2026-08-22:1049000',
      ]),
    );
  });

  it('keeps multiple adjacent price columns as source evidence for the same departure date', () => {
    const result = readSupplierDocumentLikeHuman({
      rawText: [
        '6/1 월 3박',
        '999,000',
        '1,229,000',
        '1,359,000',
        '1,439,000',
      ].join('\n'),
      durationDays: 4,
      year: 2026,
    });

    const prices = result.pricePairs
      .filter(row => row.date === '2026-06-01')
      .map(row => row.adult_price)
      .sort((a, b) => a - b);

    expect(prices).toEqual([999000, 1229000, 1359000, 1439000]);
  });

  it('recognizes labeled departure date lists with a nearby 요금표 line', () => {
    const result = readSupplierDocumentLikeHuman({
      rawText: [
        '상품명: [RAW-E2E3P] 나트랑/달랏 5성 3박5일',
        '출발일: 2027-02-04, 2027-02-11',
        '최소출발 6명 이상',
        '발권마감 출발 7일 전',
        '',
        '요금표',
        '성인 889,000원 / 아동 889,000원',
      ].join('\n'),
      durationDays: 5,
      year: 2027,
    });

    expect(result.priceSource).toBe('labeled_date_list_price');
    expect(result.pricePairs.map(row => `${row.date}:${row.adult_price}:${row.child_price}`)).toEqual([
      '2027-02-04:889000:889000',
      '2027-02-11:889000:889000',
    ]);
    expect(result.uncertainties).not.toContain('no source-backed product price/date pairs recognized by evidence reader');
  });

  it('reads monthly Korean weekday grids into date-scoped source-backed prices', () => {
    const result = readSupplierDocumentLikeHuman({
      rawText: [
        '6월',
        '1~20',
        '월',
        '3박4일',
        '759,000',
        '999,000',
        '1,179,000',
        '1,229,000',
        '화',
        '수',
        '829,000',
        '1,059,000',
        '1,259,000',
        '1,299,000',
        '목',
        '949,000',
        '1,199,000',
        '1,359,000',
        '1,399,000',
        '금',
        '899,000',
        '1,129,000',
        '1,319,000',
        '1,359,000',
        '토',
        '849,000',
        '1,069,000',
        '1,259,000',
        '1,299,000',
        '일',
      ].join('\n'),
      durationDays: 4,
      year: 2026,
    });

    const prices = result.pricePairs
      .filter(row => row.date === '2026-06-20')
      .map(row => row.adult_price)
      .sort((a, b) => a - b);

    expect(prices).toEqual([849000, 1069000, 1259000, 1299000]);
  });

  it('recovers broken Korean month/day rows followed by one package price', () => {
    const result = readSupplierDocumentLikeHuman({
      rawText: [
        '노옵션 노팁 황산 서체 4일 PKG',
        '출 발 일 자',
        '년 월 일 월 일 화26410~529',
        '여 행 경 비',
        '월     일414,21,28',
        '월 일 55,12,19,26',
        '인 849,000/',
      ].join('\n'),
      durationDays: 4,
      year: 2026,
    });

    expect(result.pricePairs.map(row => `${row.date}:${row.adult_price}`)).toEqual(
      expect.arrayContaining([
        '2026-04-14:849000',
        '2026-04-21:849000',
        '2026-04-28:849000',
        '2026-05-05:849000',
        '2026-05-12:849000',
        '2026-05-19:849000',
        '2026-05-26:849000',
      ]),
    );
  });

  it('recovers nearby Korean travel days with one product price', () => {
    const result = readSupplierDocumentLikeHuman({
      rawText: [
        '[청주공항-청도 3일]',
        '여행일 23일, 24일',
        '3월',
        '2026년',
        '상품가 [특가] 299,000원/인',
      ].join('\n'),
      durationDays: 3,
      year: 2026,
    });

    expect(result.pricePairs.map(row => `${row.date}:${row.adult_price}`)).toEqual([
      '2026-03-23:299000',
      '2026-03-24:299000',
    ]);
  });

  it('recovers golf weekday range tables with variant-specific price columns', () => {
    const rawText = [
      '상품가 단위 원',
      '정통 3색 품격 3색',
      '출 발 일',
      '월,화,수 1,349,- 1,409,-',
      '목 1,449,- 1,509,-',
      '3/1~3/18',
      '금 1,599,- 1,659,-',
      '토 1,569,- 1,629,-',
      '일 1,429,- 1,489,-',
      'PKG',
      '나가사키 정통 골프 54H 초석 2박3일',
    ].join('\n');

    const standard = readSupplierDocumentLikeHuman({
      rawText,
      title: '나가사키 정통 골프 54H 초석 2박3일',
      durationDays: 3,
      year: 2026,
    });
    const premium = readSupplierDocumentLikeHuman({
      rawText,
      title: '나가사키 품격 골프 54H 초석 2박3일',
      durationDays: 3,
      year: 2026,
    });

    expect(standard.pricePairs.find(row => row.date === '2026-03-02')?.adult_price).toBe(1349000);
    expect(standard.pricePairs.find(row => row.date === '2026-03-05')?.adult_price).toBe(1449000);
    expect(standard.pricePairs.find(row => row.date === '2026-03-06')?.adult_price).toBe(1599000);
    expect(premium.pricePairs.find(row => row.date === '2026-03-02')?.adult_price).toBe(1409000);
    expect(premium.pricePairs.find(row => row.date === '2026-03-05')?.adult_price).toBe(1509000);
    expect(premium.pricePairs.find(row => row.date === '2026-03-06')?.adult_price).toBe(1659000);
  });

  it('ignores surcharge dates when building independent product-price evidence', () => {
    const result = readSupplierDocumentLikeHuman({
      rawText: [
        '[노옵션노팁] 다낭/호이안/바나힐 5일 [진에어]',
        '발 신 일2026. 01. 05.',
        '출 발 일 자2026년 2월 24일 (화요일) 출발',
        '인 원4명부터 출발',
        '판 매 가 격',
        '\\619,000/인',
        '호텔 써차지: 1/1, 2/16~21, 4/26~28, 4/30~5/3예정 (투숙일 기준) \\30,000/룸당/박당',
      ].join('\n'),
      title: '[노옵션노팁] 다낭/호이안/바나힐 5일 [진에어]',
      durationDays: 5,
    });

    expect(result.pricePairs.map(row => `${row.date}:${row.adult_price}`)).toEqual(['2026-02-24:619000']);
  });
});
