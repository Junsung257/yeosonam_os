import { describe, it, expect } from 'vitest';
import { extractBullets } from '@/lib/parser/deterministic/bullets';
import { looksLikeCommaSplitBroken } from '@/lib/parser/deterministic/comma-split-signature';
import { extractPriceMatrix } from '@/lib/parser/deterministic/price-matrix';

/** RC1 회귀: 선택관광 섹션 없는 골프 패키지 — 옛 parser split 시 100건+ 폭주 */
const GOLF_NO_OPTIONAL_TOURS = `
후쿠오카 도스 다색골프 54H 2박3일

5/1~8/31
월~금
1,209,000
토~일
1,309,000

포함 사항
▶왕복항공료, ▶골프비용(그린피, 전동카트피), ▶호텔 2박, ▶전용차량, ▶여행자보험

불포함 사항
▶개인경비, ▶가이드/기사팁, ▶선택관광, ▶유류할증료, ▶싱글차지, ▶랜드부산 9%

비 고
※ 취소규정: 출발 30일 전 10% 수수료
※ 일본 공휴일 별도 요금

제1일
후쿠오카 도착 — 골프 라운딩
`;

describe('extractBullets (RC1 — no optional tours section)', () => {
  it('inclusions/excludes 는 6건 이하 (콤마 split 폭주 없음)', () => {
    const { inclusions, excludes } = extractBullets(GOLF_NO_OPTIONAL_TOURS);
    expect(inclusions.length).toBeLessThanOrEqual(6);
    expect(excludes.length).toBeLessThanOrEqual(6);
    expect(inclusions.some(i => i.includes('그린피, 전동카트피'))).toBe(true);
    const leaked = excludes.filter(e => e.includes('제1일') || e.includes('골프 라운딩'));
    expect(leaked, `itinerary leaked into excludes: ${JSON.stringify(leaked)}`).toEqual([]);
  });

  it('looksLikeCommaSplitBroken 은 정상 extract 결과에 false', () => {
    const { inclusions, excludes } = extractBullets(GOLF_NO_OPTIONAL_TOURS);
    expect(looksLikeCommaSplitBroken(inclusions)).toBe(false);
    expect(looksLikeCommaSplitBroken(excludes)).toBe(false);
  });

  it('깨진 176건 mock 은 comma-split 시그니처 true', () => {
    const broken = Array.from({ length: 176 }, (_, i) => `항목${i}`);
    expect(looksLikeCommaSplitBroken(broken)).toBe(true);
  });
});

describe('extractPriceMatrix (RC3 — period×DOW grid)', () => {
  it('5/1~8/31 매트릭스 expand', () => {
    const rows = extractPriceMatrix(GOLF_NO_OPTIONAL_TOURS, 2026);
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.some(r => r.adult_price === 1209000)).toBe(true);
    expect(rows.some(r => r.adult_price === 1309000)).toBe(true);
  });
});
