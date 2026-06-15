import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  extractUploadDestinationFromFilename,
  inferUploadDestinationFromText,
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
  it('resolves modern Korean destination aliases from existing destination strings', () => {
    const cases = [
      ['시즈오카 BX시내숙박 명문골프 3박4일', 'FSZ'],
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

  it('falls back from a bad existing destination string to a resolvable Kyushu alias', () => {
    const result = resolveUploadDestinationAndCodes({
      destination: '큐슈 조석 스기노이',
      departureAirport: '부산',
      durationDays: 3,
      productRawText: '크라운 · 후쿠오카 · 2박 3일 · BX142\n후쿠오카 출발\n후쿠오카 호텔 스기노이',
      documentRawText: '',
    });

    expect(result.destination).toBe('큐슈 조석 스기노이');
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
});
