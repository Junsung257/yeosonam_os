import { describe, it, expect } from 'vitest';
import { classifyInclusions, resolveShopping, resolveTermsMisc, renderPackage } from './render-contract';

describe('classifyInclusions + terms-catalog', () => {
  it('기본 포함을 카탈로그 순서로 정형화', () => {
    const { basic } = classifyInclusions([
      '여행자보험',
      '왕복항공료',
      '유류할증료(5월기준)',
      '숙박료',
      '식사',
      '관광지입장료',
      '현지차량',
    ]);
    expect(basic[0].text).toMatch(/^왕복항공료/);
    expect(basic[1].text).toMatch(/^유류할증료/);
    expect(basic[basic.length - 1].text).toMatch(/^여행자보험/);
  });
});

describe('resolveShopping + resolveTermsMisc', () => {
  it('쇼핑 본문과 정책 분리', () => {
    const s = resolveShopping({
      itinerary_data: {
        highlights: {
          shopping:
            '2회 (잡화,토속품 중) *교환이나 환불은 구매후 한달 이내에만 가능합니다. (수수료 발생)',
        },
      },
    });
    expect(s.displayLine).toBe('2회 — 잡화, 토속품 등');
    expect(s.count).toBe(2);
    expect(s.policyNote).toBeTruthy();

    const misc = resolveTermsMisc(s);
    expect(misc.items).toHaveLength(1);
    expect(misc.items[0]).toMatch(/한 달 이내/);
  });
});

describe('renderPackage excludes.display', () => {
  it('불포함 카탈로그 정형화', () => {
    const view = renderPackage({
      excludes: ['개인경비', '매너팁', '3·4일차 중식, 석식'],
    });
    expect(view.excludes.display[0].text).toBe('개인경비');
    expect(view.excludes.basic[0]).toBe('개인경비');
  });
});
