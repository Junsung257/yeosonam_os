import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  extractUploadDestinationFromFilename,
  inferUploadDestinationFromText,
  normalizeUploadDestinationDisplayLabel,
  resolveUploadDestinationAndCodes,
} from './destination-resolution';

describe('upload destination resolution', () => {
  it('recovers missing destination from product raw text before code generation', () => {
    const result = resolveUploadDestinationAndCodes({
      destination: '',
      departureAirport: '부산(김해)',
      durationDays: 5,
      productRawText: '부산출발 푸꾸옥 뉴월드 풀빌라 자유여행 5일\n푸꾸옥 국제공항 도착',
      documentRawText: '',
      tempDestination: '',
    });

    expect(result.destination).toBe('푸꾸옥');
    expect(result.source).toBe('product_raw');
    expect(result.departureCode).toBe('PUS');
    expect(result.destinationCode).toBe('PQC');
    expect(result.failures).toEqual([]);
  });

  it('keeps UNK visible as a structured failure instead of hiding it', () => {
    const result = resolveUploadDestinationAndCodes({
      destination: '알수없는도시',
      departureAirport: '김해',
      durationDays: 4,
    });

    expect(result.destination).toBe('알수없는도시');
    expect(result.destinationCode).toBe('UNK');
    expect(result.failures).toContain('destination_code:UNK:알수없는도시');
  });

  it('extracts destination from filename and raw text with shared dictionaries', () => {
    expect(extractUploadDestinationFromFilename('[랜드사_9%]세부.pdf')).toBe('세부');
    expect(inferUploadDestinationFromText('세부 세미패키지\n부산 출발\n세부 리조트')).toBe('세부');
  });
});

describe('upload destination resolution Korean aliases', () => {
  it('resolves readable Korean Shijiazhuang/Taihangshan aliases', () => {
    const result = resolveUploadDestinationAndCodes({
      destination: '석가장/태항산(보천&천계산) 4일',
      departureAirport: '부산',
      durationDays: 4,
      productRawText: '[노옵션+노팁] 석가장/태항산(보천&천계산) 4일',
      documentRawText: '',
    });

    expect(result.destinationCode).toBe('SJW');
    expect(result.failures).toEqual([]);
  });

  it('resolves modern Korean destination aliases from existing destination strings', () => {
    const cases = [
      ['시즈오카 BX시내숙박 명문골프 3박4일', 'FSZ'],
      ['나가사키 전세기 오션팰리스 연장', 'NGS'],
      ['황하석림, 바단지린, 칠채산', 'XIY'],
      ['란주, 황하석림, 바단지린, 칠채산', 'XIY'],
      ['청도 색골프 2박3일 BX', 'TAO'],
      ['북해도 3박4일 온천 2박 시내 1박 도야 오타루 삿포로', 'CTS'],
      ['토야마 온천3박 알펜루트 쿠로베열차', 'TOY'],
      ['비엔티안/루앙프라방/방비엥 노팁노옵션', 'VTE'],
      ['울란바토르 테를지 엘승 실속패키지', 'UBN'],
      ['마나도 3박 5일 부나켄 아일랜드 호핑', 'MDC'],
      ['장가계+부용진 4박5일 노팁노옵션', 'DYG'],
    ] as const;

    for (const [destination, destinationCode] of cases) {
      const result = resolveUploadDestinationAndCodes({
        destination,
        departureAirport: '부산',
        durationDays: 5,
        productRawText: destination,
        documentRawText: destination,
      });

      expect(result.destinationCode).toBe(destinationCode);
      expect(result.failures).toEqual([]);
    }
  });

  it('infers modern Korean destination aliases from raw text when the destination field is empty', () => {
    const result = resolveUploadDestinationAndCodes({
      destination: '',
      departureAirport: '부산',
      durationDays: 5,
      productRawText: 'PKG 노팁 노옵션/울란바토르 테를지 엘승\n울란바토르 공항 도착 후 테를지 이동',
      documentRawText: '',
    });

    expect(result.destination).toBe('울란바토르');
    expect(result.source).toBe('product_raw');
    expect(result.destinationCode).toBe('UBN');
    expect(result.failures).toEqual([]);
  });

  it('resolves modern Korean Fukuoka text to FUK without UNK fallback', () => {
    const result = resolveUploadDestinationAndCodes({
      destination: '',
      departureAirport: '부산',
      durationDays: 3,
      productRawText: 'BX후쿠오카 파라다이스 골프 패키지 54H 초석 2박3일\n후쿠오카 국제공항 도착',
      documentRawText: '',
    });

    expect(result.destination).toBe('후쿠오카');
    expect(result.departureCode).toBe('PUS');
    expect(result.destinationCode).toBe('FUK');
    expect(result.failures).toEqual([]);
  });

  it('resolves Clark golf catalog text to CRK without UNK fallback', () => {
    const result = resolveUploadDestinationAndCodes({
      destination: '',
      departureAirport: '부산',
      durationDays: 5,
      productRawText: 'PKG\n클락 알뜰 3색골프 + 단독차량 3박5일\n클락 공항 도착',
      documentRawText: '',
    });

    expect(result.destination).toBe('클락');
    expect(result.destinationCode).toBe('CRK');
    expect(result.failures).toEqual([]);
  });

  it('prefers source-backed Guangzhou over unrelated existing Chinese destinations', () => {
    for (const staleDestination of ['계림', '북경']) {
      const result = resolveUploadDestinationAndCodes({
        destination: staleDestination,
        departureAirport: '부산',
        durationDays: 5,
        productRawText: '광저우 천저우 3박5일\n광저우 도착 후 천저우 이동',
        documentRawText: '',
      });

      expect(result.destination).toBe('광저우');
      expect(result.source).toBe('product_raw');
      expect(result.destinationCode).toBe('CAN');
      expect(result.failures).toEqual([]);
    }
  });

  it('does not treat a destination substring inside a hotel name as route evidence', () => {
    const rawText = [
      '청주- 석가장 [ 보천대협곡/천계산/대협곡 ] 4일',
      '석가장 국제공항 도착',
      '임주 람월만베이 또는 환빈서안호텔 또는 동급',
    ].join('\n');
    const result = resolveUploadDestinationAndCodes({
      destination: '서안',
      departureAirport: '청주',
      durationDays: 4,
      productRawText: rawText,
      documentRawText: rawText,
      tempDestination: '태항산',
    });

    expect(result.destination).toBe('석가장');
    expect(result.source).toBe('product_raw');
    expect(result.destinationCode).toBe('SJW');
  });

  it('resolves Narita/Chiba golf catalog text to Tokyo airport group', () => {
    const rawText = readFileSync(
      join(process.cwd(), 'src/lib/product-registration/golden-corpus/fixtures/joshi-golf-menu-multiproduct.txt'),
      'utf8',
    );

    const result = resolveUploadDestinationAndCodes({
      destination: '',
      departureAirport: '부산',
      durationDays: 4,
      productRawText: rawText,
      documentRawText: '',
    });

    expect(result.destination).toBe('나리타');
    expect(result.destinationCode).toBe('TYO');
    expect(result.failures).toEqual([]);
  });

  it('normalizes a noisy existing destination string to its resolvable Kyushu place label', () => {
    const result = resolveUploadDestinationAndCodes({
      destination: '큐슈 조석 스기노이',
      departureAirport: '부산',
      durationDays: 3,
      productRawText: '크라운 · 후쿠오카 · 2박 3일 · BX142\n후쿠오카 출발\n후쿠오카 호텔 스기노이',
      documentRawText: '',
    });

    expect(result.destination).toBe('큐슈');
    expect(result.destinationCode).toBe('FUK');
    expect(result.source).toBe('existing');
    expect(result.failures).toEqual([]);
  });

  it('recovers Tsushima when the parser leaves supplier/ferry text in destination', () => {
    const rawText = `4. [대마도 자연과 역사탐방 2일] - 노바 (이즈-히타)
2026년 6월17일 & 6월 24일(수) 출발 단2회! [1박2일]
부산 출발 / 이즈하라 향발
대마도 사무라이거리 및 방화벽
히타카츠 출발 / 부산 향발`;

    const result = resolveUploadDestinationAndCodes({
      destination: '4. - 노바 이즈-히타',
      departureAirport: '부산',
      durationDays: 2,
      productRawText: rawText,
      documentRawText: rawText,
    });

    expect(result.destination).toBe('대마도');
    expect(result.source).toBe('product_raw');
    expect(result.destinationCode).toBe('TSJ');
    expect(result.failures).toEqual([]);
  });

  it('recovers Hanoi from source-backed Air Busan charter flight hints when OCR drops the city name', () => {
    const rawText = `
02/25 - 819,000 / 02/26 - 899,000
[BX] / / 3 5
BX7395 20:30 23:30
Lotte Center Hanoi 65
BX7305 00:40 07:05
`;

    const result = resolveUploadDestinationAndCodes({
      destination: '',
      departureAirport: '부산',
      durationDays: 5,
      productRawText: rawText,
      documentRawText: rawText,
    });

    expect(result.destination).toBe('하노이');
    expect(result.source).toBe('product_raw');
    expect(result.destinationCode).toBe('HAN');
    expect(result.failures).toEqual([]);
  });

  it.each([
    ['천진 진황도 골프', 'TSN'],
    ['톈진 친황다오 골프', 'TSN'],
    ['심양 도심 골프', 'SHE'],
    ['선양 도심 골프', 'SHE'],
  ])('resolves northeast China alias %s to %s', (destination, expectedCode) => {
    expect(resolveUploadDestinationAndCodes({
      destination,
      productRawText: destination,
    }).destinationCode).toBe(expectedCode);
  });

  it.each([
    ['실속 치앙마이 3색골프 + 관광', 'CNX', '치앙마이'],
    ['품격 치앙마이 4색골프 + 관광', 'CNX', '치앙마이'],
    ['노옵션/노쇼핑 가오슝 품격 3색골프', 'KHH', '가오슝'],
    ['괌 파인이스트 골프텔', 'GUM', '괌'],
    ['삿포로 니세코 골프 힐튼호텔 63H', 'CTS', '삿포로/니세코'],
    ['삿포로 품격 시내 3색골프', 'CTS', '삿포로'],
    ['청도 2색골프', 'TAO', '청도'],
    ['청도 3색골프', 'TAO', '청도'],
    ['노팁/노옵션 특급호텔 청도 + 맥주박물관', 'TAO', '청도'],
    ['코타키나발루 보르네오 무제한 라운딩', 'BKI', '코타키나발루'],
    ['심양 시내 힐튼 + 도심3색골프', 'SHE', '심양'],
    ['서안/진시황릉', 'XIY', '서안'],
    ['타이페이/예스지', 'TPE', '타이페이'],
  ])('normalizes customer destination %s to %s place labels', (destination, code, expected) => {
    expect(normalizeUploadDestinationDisplayLabel(destination, code)).toBe(expected);
  });

  it.each([
    ['석가장/태항산', 'SJW'],
    ['장가계/천자산', 'DYG'],
    ['연길/백두산', 'YNJ'],
    ['마카오/홍콩', 'HKG'],
  ])('preserves clean compound destination %s', (destination, code) => {
    expect(normalizeUploadDestinationDisplayLabel(destination, code)).toBe(destination);
  });
});
