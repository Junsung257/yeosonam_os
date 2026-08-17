import { describe, expect, it } from 'vitest';

import { buildPublicPackageSnapshot } from './public-snapshot';
import { buildPublicTermsPolicy } from './public-terms-policy';

describe('public terms policy', () => {
  it('preserves evidence-verified golf commercial terms in customer language', () => {
    const result = buildPublicTermsPolicy({
      inclusions: [],
      exclusions: [],
      verifiedInclusions: [
        '왕복 항공료+유류+TAX',
        '골프 수하물 23KG',
        '여행자보험',
        '호텔2인1실',
        '호텔조식',
        '일정상 그린피+카트비',
        '공항-호텔-골프장 송영차량(일본인)',
      ],
      verifiedExclusions: [
        '클럽 중식',
        '석식',
        '기타 개인비용',
        '싱글차지 1인/1박/4만원',
        '2-3인플레이',
      ],
    });

    expect(result.inclusionsPublic).toEqual([
      '왕복 항공료·유류할증료·TAX',
      '골프 수하물 23kg',
      '여행자보험',
      '호텔 2인 1실',
      '호텔 조식',
      '일정표상 그린피·카트비',
      '공항·호텔·골프장 송영차량',
    ]);
    expect(result.exclusionsPublic).toEqual([
      '골프장 중식',
      '석식',
      '기타 개인비용',
      '싱글룸 추가비(1인·1박 4만 원)',
      '2~3인 플레이 추가비용',
    ]);
  });

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
      '기사/가이드 경비 $50/인',
      '선택관광 비용',
    ]);
    expect(result.inclusionsPublic).not.toEqual(expect.arrayContaining(['노옵션', '599', '000원/인', '상품가']));
    expect(result.exclusionsPublic).not.toEqual(expect.arrayContaining(['7월 5', '불포함 내역']));
  });

  it('preserves source-backed international airfare, tax, and etiquette tip', () => {
    const result = buildPublicTermsPolicy({
      inclusions: [],
      exclusions: [],
      verifiedInclusions: ['국제선 항공요금', '텍스', '현지 행사비 (호텔', '차량', '식사', '가이드', '관광지 입장료)', '여행자보험'],
      verifiedExclusions: ['기사/가이드경비 1인 $50', '에티켓팁', '기타 개인경비'],
    });

    expect(result.inclusionsPublic).toEqual([
      '왕복항공료',
      'TAX',
      '숙박',
      '현지차량',
      '일정표상 식사',
      '가이드',
      '관광지 입장료',
      '여행자보험',
    ]);
    expect(result.exclusionsPublic).toEqual([
      '기사/가이드 경비 $50/인',
      '에티켓팁',
      '개인경비',
    ]);
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
    expect(result.exclusionsPublic).toEqual(['개인경비', '기사/가이드 경비 $50/인']);
  });

  it('infers customer-safe terms from raw supplier lines when headings are missing', () => {
    const result = buildPublicTermsPolicy({
      inclusions: [],
      exclusions: [],
      rawText: [
        '\uC655\uBCF5\uD56D\uACF5\uB8CC, \uC720\uB958\uD560\uC99D\uB8CC(4\uC6D4), TAX, \uD638\uD154(2\uC7781\uC2E4), \uC2DD\uC0AC, \uC804\uC6A9\uCC28\uB7C9(6\uBA85 \uC774\uC0C1 \uB9AC\uBB34\uC9C4\uBC84\uC2A4 / \uC774\uD558 9\uC778\uC2B9 \uBCA4),',
        '\uAE30\uC0AC, \uAC00\uC774\uB4DC, \uAD00\uAD11\uC9C0 \uC785\uC7A5\uB8CC, \uC5EC\uD589\uC790\uBCF4\uD5D8',
        '\uC720\uB958\uBCC0\uB3D9\uBD84, \uC2F1\uAE00\uCC28\uC9C0($80/\uC778/\uC804\uC77C\uC815), \uAC1C\uC778\uACBD\uBE44 \uBC0F \uB9E4\uB108\uD301, \uAE30\uC0AC&\uAC00\uC774\uB4DC\uD301 $40/\uC778',
        '\uC120\uD0DD\uAD00\uAD11',
      ].join('\n'),
    });

    expect(result.inclusionsPublic).toEqual([
      '\uC655\uBCF5\uD56D\uACF5\uB8CC',
      '\uC720\uB958\uD560\uC99D\uB8CC',
      '\uC219\uBC15',
      '\uC77C\uC815\uD45C\uC0C1 \uC2DD\uC0AC',
      '\uD604\uC9C0\uCC28\uB7C9',
      'TAX',
      '\uAC00\uC774\uB4DC',
      '\uAD00\uAD11\uC9C0 \uC785\uC7A5\uB8CC',
      '\uC5EC\uD589\uC790\uBCF4\uD5D8',
    ]);
    expect(result.exclusionsPublic).toEqual([
      '\uAC1C\uC778\uACBD\uBE44',
      '\uB9E4\uB108\uD301',
      '\uAE30\uC0AC/\uAC00\uC774\uB4DC \uACBD\uBE44 $40/\uC778',
      '\uC2F1\uAE00\uB8F8 \uCD94\uAC00\uBE44',
    ]);
  });

  it('splits attached include and exclude headings into multiple public labels', () => {
    const result = buildPublicTermsPolicy({
      inclusions: [],
      exclusions: [],
      rawText: [
        '\uD3EC    \uD568\uC655\uBCF5\uD56D\uACF5\uB8CC \uD638\uD154(2\uC7781\uC2E4) \uC2DD\uC0AC \uC804\uC6A9\uCC28\uB7C9 \uC5EC\uD589\uC790\uBCF4\uD5D8 \uC2A4\uB8E8\uAC00\uC774\uB4DC \uAD00\uAD11\uC9C0 \uC785\uC7A5\uB8CC',
        '\uBD88 \uD3EC \uD568\uC2F1\uAE00\uCC28\uC9C0, \uAC1C\uC778\uACBD\uBE44, \uAE30\uC0AC\uAC00\uC774\uB4DC\uACBD\uBE44 40,000\uC6D0/\uC778',
      ].join('\n'),
    });

    expect(result.inclusionsPublic).toEqual([
      '\uC655\uBCF5\uD56D\uACF5\uB8CC',
      '\uC219\uBC15',
      '\uC77C\uC815\uD45C\uC0C1 \uC2DD\uC0AC',
      '\uD604\uC9C0\uCC28\uB7C9',
      '\uAC00\uC774\uB4DC',
      '\uAD00\uAD11\uC9C0 \uC785\uC7A5\uB8CC',
      '\uC5EC\uD589\uC790\uBCF4\uD5D8',
    ]);
    expect(result.exclusionsPublic).toEqual([
      '\uAC1C\uC778\uACBD\uBE44',
      '\uAE30\uC0AC/\uAC00\uC774\uB4DC \uACBD\uBE44 40,000\uC6D0',
      '\uC2F1\uAE00\uB8F8 \uCD94\uAC00\uBE44',
    ]);
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
    expect(snapshot.exclusions_public).toEqual(['개인경비', '기사/가이드 경비 $50/인']);
    expect(snapshot.optional_tours_public).toEqual([]);
    expect(snapshot.package.inclusions).toEqual(snapshot.inclusions_public);
    expect(snapshot.package.excludes).toEqual(snapshot.exclusions_public);
    expect(JSON.stringify(snapshot.canonical_view)).not.toContain('599');
    expect(JSON.stringify(snapshot.canonical_view)).not.toContain('000원/인');
    expect(JSON.stringify(snapshot.canonical_view)).not.toContain('포 함 내 역');
    expect(snapshot.inclusions_public).not.toEqual(expect.arrayContaining(['노옵션']));
  });
});
