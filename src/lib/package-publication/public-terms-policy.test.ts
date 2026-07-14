import { describe, expect, it } from 'vitest';

import { buildPublicPackageSnapshot } from './public-snapshot';
import { buildPublicTermsPolicy } from './public-terms-policy';

describe('public terms policy', () => {
  it('keeps only customer-safe inclusion and exclusion labels', () => {
    const result = buildPublicTermsPolicy({
      inclusions: [
        '포 함 내 역',
        '왕복항공료(현지공항세포함)',
        '유류할증료 · 7월 기준',
        '숙박료',
        '식사(일정표)',
        '관광지입장료',
        '현지차량',
        '가이드',
        '노옵션',
        '599',
        '000원/인',
        '상품가',
      ],
      exclusions: [
        '불포함 내역',
        '개인경비 · 매너팁',
        '기사/가이드경비 $50/인',
        '선택관광 비용',
        '7월 5',
      ],
    });

    expect(result.inclusionsPublic).toEqual([
      '왕복항공료',
      '유류할증료',
      '숙박',
      '일정표상 식사',
      '관광지 입장료',
      '현지차량',
      '가이드',
    ]);
    expect(result.exclusionsPublic).toEqual([
      '개인경비',
      '매너팁',
      '기사/가이드 경비',
      '선택관광 비용',
    ]);
    expect(result.inclusionsPublic).not.toEqual(expect.arrayContaining(['노옵션', '599', '000원/인', '상품가']));
    expect(result.exclusionsPublic).not.toEqual(expect.arrayContaining(['7월 5', '불포함 내역']));
  });

  it('regenerates public terms from raw source sections when saved arrays are polluted', () => {
    const result = buildPublicTermsPolicy({
      inclusions: ['포 함 내 역', '599', '000원/인'],
      exclusions: ['불포함 내역', '출발일'],
      rawText: [
        '포함내역',
        '왕복항공료(현지공항세포함)',
        '숙박료',
        '식사(일정표)',
        '관광지입장료',
        '현지차량',
        '가이드',
        '불포함내역',
        '개인경비',
        '기사/가이드경비 $50/인',
        '선택관광',
        '노옵션',
        '상품가',
        '599,000원/인',
      ].join('\n'),
    });

    expect(result.inclusionsPublic).toEqual([
      '왕복항공료',
      '숙박',
      '일정표상 식사',
      '관광지 입장료',
      '현지차량',
      '가이드',
    ]);
    expect(result.exclusionsPublic).toEqual(['개인경비', '기사/가이드 경비']);
  });

  it('makes the public snapshot use regenerated terms across canonical and projection surfaces', () => {
    const { snapshot } = buildPublicPackageSnapshot({
      id: 'terms-policy-sample',
      package_revision: 3,
      title: '연길 5성 온천 4박5일',
      destination: '연길',
      duration: 5,
      nights: 4,
      price: 599000,
      product_prices: [{ target_date: '2026-07-12', adult_selling_price: 599000 }],
      products: {
        display_name: '연길·백두산 패키지',
        thumbnail_urls: ['https://cdn.yeosonam.com/packages/yanji.jpg'],
      },
      raw_text: [
        '연길 5성 온천 4박5일',
        '선택관광: 노옵션',
        '포함내역',
        '왕복항공료(현지공항세포함)',
        '숙박료',
        '식사(일정표)',
        '관광지입장료',
        '현지차량',
        '가이드',
        '불포함내역',
        '개인경비',
        '기사/가이드경비 $50/인',
        '선택관광',
        '노옵션',
        '상품가',
        '599,000원/인',
      ].join('\n'),
      inclusions: ['포 함 내 역', '차량', '가이드', '599', '000원/인', '노옵션'],
      excludes: ['불포함 내역', '개인경비', '기사/가이드경비 $50/인', '7월 5'],
      optional_tours: ['7월 5', '599', '000원/인', '포 함 내 역', '차량', '가이드', '노옵션'],
      itinerary_data: {
        days: [
          { day: 1, schedule: [{ activity: '연길 이동' }] },
          { day: 2, schedule: [{ activity: '백두산 천지 관광' }] },
        ],
      },
    });

    expect(snapshot.inclusions_public).toEqual([
      '현지차량',
      '가이드',
      '왕복항공료',
      '숙박',
      '일정표상 식사',
      '관광지 입장료',
    ]);
    expect(snapshot.exclusions_public).toEqual(['개인경비', '기사/가이드 경비']);
    expect(snapshot.optional_tours_public).toEqual([]);
    expect(snapshot.package.inclusions).toEqual(snapshot.inclusions_public);
    expect(snapshot.package.excludes).toEqual(snapshot.exclusions_public);
    expect(JSON.stringify(snapshot.canonical_view)).not.toContain('599');
    expect(JSON.stringify(snapshot.canonical_view)).not.toContain('000원/인');
    expect(JSON.stringify(snapshot.canonical_view)).not.toContain('포 함 내 역');
    expect(snapshot.inclusions_public).not.toEqual(expect.arrayContaining(['노옵션']));
  });
});
