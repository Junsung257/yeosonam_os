import { describe, expect, it } from 'vitest';

import {
  extractOcrCriticalTokens,
  getOcrProviderMode,
  ocrCriticalTokensMatch,
  parseLocalOcrOutput,
} from './ocr-providers';

describe('OCR critical-value cross validation', () => {
  it('extracts price, departure date and flight number tokens', () => {
    expect(extractOcrCriticalTokens('출발 2026-09-19 BX321 성인 599,000원')).toEqual([
      '2026-09-19',
      '599,000원',
      'BX321',
    ]);
  });

  it('rejects a one-digit price disagreement even when the rest matches', () => {
    expect(ocrCriticalTokensMatch(
      extractOcrCriticalTokens('2026-09-19 BX321 599,000원'),
      extractOcrCriticalTokens('2026-09-19 BX321 699,000원'),
    )).toBe(false);
  });

  it('ignores provider token ordering but not token content', () => {
    expect(ocrCriticalTokensMatch(
      ['BX321', '599,000원', '2026-09-19'],
      ['2026-09-19', 'BX321', '599,000원'],
    )).toBe(true);
  });

  it('matches formatted and unformatted prices without weakening date or flight checks', () => {
    expect(ocrCriticalTokensMatch(
      extractOcrCriticalTokens('2026-09-19 BX321 599,000원'),
      extractOcrCriticalTokens('2026-09-19 BX321 599000원'),
    )).toBe(true);
    expect(ocrCriticalTokensMatch(
      extractOcrCriticalTokens('2026-09-19 BX321 599,000원'),
      extractOcrCriticalTokens('2026-09-20 BX321 599000원'),
    )).toBe(false);
  });

  it('parses the bounded local PaddleOCR JSON envelope with table evidence', () => {
    const result = parseLocalOcrOutput({
      kind: 'paddleocr-local',
      modelVersion: 'pp-ocrv5-test',
      stdout: JSON.stringify({
        rawModelVersion: 'pp-structurev3-test',
        text: '출발 2026-09-19 성인 599,000원',
        pages: [{
          page: 1,
          text: '출발 2026-09-19 성인 599,000원',
          nodes: [{ text: '599,000원', confidence: 0.99, boundingBox: { x: 1 } }],
          tables: [{ cells: [{ row: 0, column: 1, rowSpan: 1, colSpan: 2, text: '599,000원' }] }],
        }],
      }),
    });

    expect(result).toMatchObject({
      provider: 'paddleocr-local',
      rawModelVersion: 'pp-structurev3-test',
      costKrw: 0,
      pages: [{ tables: [{ cells: [{ row: 0, column: 1, colSpan: 2, text: '599,000원' }] }] }],
    });
  });

  it('accepts Tesseract plain text but rejects non-JSON PaddleOCR output', () => {
    expect(parseLocalOcrOutput({
      kind: 'tesseract-local',
      stdout: '출발 2026-09-19 성인 599,000원',
    }).provider).toBe('tesseract-local');
    expect(() => parseLocalOcrOutput({
      kind: 'paddleocr-local',
      stdout: 'PaddleOCR started\n출발 2026-09-19 성인 599,000원',
    })).toThrow('PADDLEOCR_LOCAL_JSON_REQUIRED');
  });

  it('defaults the OCR profile to local and only opts into cloud explicitly', () => {
    const previous = process.env.PRODUCT_REGISTRATION_OCR_PROVIDER_MODE;
    try {
      delete process.env.PRODUCT_REGISTRATION_OCR_PROVIDER_MODE;
      expect(getOcrProviderMode()).toBe('local');
      process.env.PRODUCT_REGISTRATION_OCR_PROVIDER_MODE = 'cloud';
      expect(getOcrProviderMode()).toBe('cloud');
    } finally {
      if (previous === undefined) delete process.env.PRODUCT_REGISTRATION_OCR_PROVIDER_MODE;
      else process.env.PRODUCT_REGISTRATION_OCR_PROVIDER_MODE = previous;
    }
  });
});
