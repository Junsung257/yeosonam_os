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
});
