import { describe, expect, it } from 'vitest';
import { destinationToIsoSet, KOREAN_DESTINATION_TO_ISO, inferCountryFromDestination } from './destination-iso';

describe('destination-iso SSOT', () => {
  it('단일 도시 매핑', () => {
    expect(destinationToIsoSet('나트랑')).toEqual(new Set(['VN']));
    expect(destinationToIsoSet('후쿠오카')).toEqual(new Set(['JP']));
    expect(destinationToIsoSet('치앙마이')).toEqual(new Set(['TH']));
  });

  it('슬래시 구분자', () => {
    expect(destinationToIsoSet('나트랑/달랏')).toEqual(new Set(['VN']));
  });

  it('콤마 / 중점 / 앰퍼샌드 구분자', () => {
    expect(destinationToIsoSet('도쿄,오사카·교토')).toEqual(new Set(['JP']));
    expect(destinationToIsoSet('홍콩 & 마카오')).toEqual(new Set(['HK', 'MO']));
  });

  it('국가별 다중 도시 합산', () => {
    expect(destinationToIsoSet('나트랑/푸꾸옥/하노이')).toEqual(new Set(['VN']));
  });

  it('빈/null/모르는 도시', () => {
    expect(destinationToIsoSet(null)).toEqual(new Set());
    expect(destinationToIsoSet('')).toEqual(new Set());
    expect(destinationToIsoSet('알수없는도시')).toEqual(new Set());
  });

  it('국가명 토큰도 매핑', () => {
    expect(destinationToIsoSet('베트남')).toEqual(new Set(['VN']));
    expect(destinationToIsoSet('일본')).toEqual(new Set(['JP']));
  });

  it('SSOT 무결성 — 모든 값이 ISO2 alpha-2', () => {
    for (const [korean, iso] of Object.entries(KOREAN_DESTINATION_TO_ISO)) {
      expect(iso, `${korean} mapping`).toMatch(/^[A-Z]{2}$/);
      expect(korean.length, `${korean} 한글 토큰`).toBeGreaterThanOrEqual(2);
    }
  });

  it('도멘 드 마리 성당 케이스 (2026-05-15 회귀 차단)', () => {
    // 사장님 사고: [LJ] 나트랑/달랏 → 달랏 attractions country='VN' 매칭 누락이 root cause
    expect(destinationToIsoSet('나트랑/달랏')).toEqual(new Set(['VN']));
    expect(KOREAN_DESTINATION_TO_ISO['달랏']).toBe('VN');
    expect(KOREAN_DESTINATION_TO_ISO['나트랑']).toBe('VN');
  });

  // 시즈오카 사고 (ERR-shizuoka-country-destination @ 2026-05-16) 회귀 차단.
  // 일본 JP 매핑 13개 누락이 모바일 attraction 카드 8개 전체 미표출 사고를 일으킴.
  describe('시즈오카 사고 회귀 차단 (일본 JP 매핑)', () => {
    it.each([
      '시즈오카', '카와구치', '카와구치코', '이즈', '이즈반도',
      '미시마', '하코네', '센다이', '가고시마', '구마모토',
      '나고야', '히로시마', '고베', '요코하마',
    ])('"%s" → JP', (dest) => {
      expect(KOREAN_DESTINATION_TO_ISO[dest]).toBe('JP');
    });
  });

  describe('inferCountryFromDestination — 단일 ISO 추론', () => {
    it('시즈오카 → JP (시즈오카 사고 직접 fix)', () => {
      expect(inferCountryFromDestination('시즈오카')).toBe('JP');
    });
    it('"시즈오카/카와구치" 복합 → JP (첫 매칭 우선)', () => {
      expect(inferCountryFromDestination('시즈오카/카와구치')).toBe('JP');
    });
    it('null/empty → null', () => {
      expect(inferCountryFromDestination(null)).toBeNull();
      expect(inferCountryFromDestination(undefined)).toBeNull();
      expect(inferCountryFromDestination('')).toBeNull();
    });
    it('매핑 미존재 → null (silent)', () => {
      expect(inferCountryFromDestination('알수없는도시')).toBeNull();
    });
  });
});
