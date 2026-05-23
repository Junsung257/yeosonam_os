import { describe, it, expect } from 'vitest';
import {
  matchInclusionCatalog,
  matchExclusionCatalog,
  normalizeCatalogInclusions,
  normalizeCatalogExcludes,
  normalizeCatalogSurchargeLine,
  parseShoppingText,
  formatInclusionDisplay,
  formatShoppingDisplay,
  INCLUSION_CATALOG,
  SHOPPING_POLICY_NOTE,
} from './terms-catalog';

describe('matchInclusionCatalog', () => {
  it('왕복항공료 + 괄호 각주', () => {
    const m = matchInclusionCatalog('왕복항공권(현지공항세 포함)');
    expect(m?.slug).toBe('round_trip_airfare');
    expect(m?.footnote).toMatch(/현지공항세/);
  });

  it('유류할증료', () => {
    expect(matchInclusionCatalog('유류할증료(5월기준)')?.slug).toBe('fuel_surcharge');
  });
});

describe('normalizeCatalogInclusions', () => {
  it('보홀 슬림팩형 포함 7종 → 표준 라벨·순서', () => {
    const raw = [
      '왕복항공료(현지공항세포함)',
      '유류할증료(5월기준)',
      '숙박료',
      '식사(일정표)',
      '관광지입장료',
      '현지차량',
      '여행자보험',
    ];
    const lines = normalizeCatalogInclusions(raw);
    expect(lines.map(l => l.text)).toEqual([
      '왕복항공료(현지공항세포함)',
      '유류할증료(5월기준)',
      '숙박료',
      '식사(일정표)',
      '관광지입장료',
      '현지차량',
      '여행자보험',
    ]);
  });

  it('카탈로그 미매칭 항목은 원문 유지', () => {
    const lines = normalizeCatalogInclusions(['노팁/노옵션/노쇼핑']);
    expect(lines.some(l => l.text === '노팁/노옵션/노쇼핑')).toBe(true);
  });

  it('숙박료·항공료 접미사 "료" remainder 찌꺼기 없음', () => {
    const lines = normalizeCatalogInclusions([
      '숙박료',
      '왕복항공료(공항세포함)',
      '관광지입장료',
      '유류할증료(5월기준)',
    ]);
    expect(lines.every(l => !l.remainder)).toBe(true);
  });
});

describe('normalizeCatalogExcludes', () => {
  it('표준 불포함 + 일차별 식사 혼합', () => {
    const lines = normalizeCatalogExcludes([
      '개인경비',
      '매너팁',
      '3·4일차 중식, 석식',
      '5일차 석식',
    ]);
    expect(lines[0].text).toBe('개인경비');
    expect(lines[1].text).toBe('매너팁');
    expect(lines.some(l => l.text.includes('3·4일차'))).toBe(true);
  });
});

describe('normalizeCatalogSurchargeLine', () => {
  it('기사/가이드팁 — 아동·성인 ($50), remainder 중복 없음', () => {
    const line = normalizeCatalogSurchargeLine('기사/가이드팁-아동,성인동일($50)');
    expect(line.text).toMatch(/기사\/가이드팁/);
    expect(line.text).toMatch(/\$50/);
    expect(line.remainder).toBeNull();
  });
});

describe('parseShoppingText', () => {
  it('본문 정형 + 정책 분리', () => {
    const raw =
      '2회 (잡화,토속품 중) *교환이나 환불은 구매후 한달 이내에만 가능합니다. (수수료 발생)';
    const p = parseShoppingText(raw);
    expect(p.count).toBe(2);
    expect(p.items).toEqual(['잡화', '토속품']);
    expect(p.displayLine).toBe('2회 — 잡화, 토속품 등');
    expect(p.policyNote).toMatch(/수수료 발생/);
    expect(p.remainder).toBeNull();
  });

  it('formatShoppingDisplay', () => {
    expect(formatShoppingDisplay(2, ['잡화', '토속품'])).toBe('2회 — 잡화, 토속품 등');
  });
});

describe('formatInclusionDisplay', () => {
  it('각주 없으면 defaultFootnote 사용', () => {
    const entry = INCLUSION_CATALOG.find(e => e.slug === 'round_trip_airfare')!;
    expect(formatInclusionDisplay(entry, null)).toBe('왕복항공료(현지공항세포함)');
  });
});

describe('SHOPPING_POLICY_NOTE', () => {
  it('기타 안내용 문구 존재', () => {
    expect(SHOPPING_POLICY_NOTE).toMatch(/한 달 이내/);
  });
});
