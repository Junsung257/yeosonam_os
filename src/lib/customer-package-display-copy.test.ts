import { describe, expect, it } from 'vitest';

import { buildCustomerPackageDisplayCopy } from './customer-package-display-copy';

describe('buildCustomerPackageDisplayCopy', () => {
  it('removes a no-tip claim when the detailed exclusions require guide/driver tip', () => {
    const copy = buildCustomerPackageDisplayCopy({
      title: '몽골 노팁 노옵션 3박5일',
      destination: '몽골',
      duration: 5,
      nights: 3,
      excludes: ['가이드/기사 팁 $40은 현지 별도 지불입니다.'],
      optional_tours: [{ name: '승마 체험', note: '희망자만 선택하는 유료 체험' }],
    });
    expect(copy.badges).not.toContain('노팁');
    expect(copy.badges).toContain('노옵션');
    expect(copy.heroHeadline).not.toContain('노팁');
  });

  it('keeps no-option for genuinely optional paid activities but removes it for mandatory options', () => {
    const optional = buildCustomerPackageDisplayCopy({
      title: '방콕 노옵션 3박5일',
      destination: '방콕',
      duration: 5,
      nights: 3,
      optional_tours: [{ name: '수상스포츠', note: '희망자 선택, $20~$80' }],
    });
    expect(optional.badges).toContain('노옵션');

    const mandatory = buildCustomerPackageDisplayCopy({
      title: '방콕 노옵션 3박5일',
      destination: '방콕',
      duration: 5,
      nights: 3,
      excludes: ['선택관광 1회는 필수 진행이며 현지 별도 지불'],
    });
    expect(mandatory.badges).not.toContain('노옵션');
    expect(mandatory.heroHeadline).not.toContain('노옵션');
  });

  it('removes supplier price-volatility warnings from customer copy', () => {
    const copy = buildCustomerPackageDisplayCopy({
      title: '청도 골프 3박4일',
      destination: '청도',
      duration: 4,
      nights: 3,
      product_summary: '청도 골프 일정입니다. 항공 블럭 마감 시 추가 항공료가 발생합니다. 예약시 상품가 재체크 바랍니다.',
    });
    expect(`${copy.summaryLead} ${copy.summaryBody}`).not.toMatch(/항공\s*블럭|상품가\s*재체크/u);
  });
  it('builds customer-first titles with duration and strong selling conditions', () => {
    const copy = buildCustomerPackageDisplayCopy({
      title: 'LJ 저녁출발] 푸꾸옥 노옵션 패키지 3박5일',
      destination: '푸꾸옥',
      duration: 5,
      nights: 3,
      product_highlights: ['노팁', '노옵션', '리조트 휴양'],
    });

    expect(copy.heroHeadline).toBe('푸꾸옥 노팁·노옵션 휴양 3박5일');
    expect(copy.heroHeadline).not.toMatch(/LJ|패키지/);
    expect(copy.badges).toEqual(expect.arrayContaining(['노팁', '노옵션']));
  });

  it('removes risky inventory and promotion words from customer titles', () => {
    const copy = buildCustomerPackageDisplayCopy({
      title: '(0709발권,스팟특가) 나트랑달랏 가성비 일정표 - 10컴',
      display_title: '출발확정 나트랑/달랏 5성 3박5일 긴급특가',
      destination: '나트랑',
      duration: 5,
      nights: 3,
      product_highlights: ['전일정 5성호텔', '달랏 관광'],
    });

    expect(copy.heroHeadline).toBe('나트랑·달랏 5성 핵심관광 3박5일');
    expect(copy.heroHeadline).not.toMatch(/출발확정|긴급|특가|발권|10컴/);
  });

  it('keeps no-tip and no-option before lower priority route facts', () => {
    const copy = buildCustomerPackageDisplayCopy({
      title: 'BX7315] 다낭/호이안 오전자유 노팁노옵션 3박5일',
      destination: '다낭',
      duration: 5,
      nights: 3,
      product_highlights: ['바나힐 포함', '호이안 관광'],
    });

    expect(copy.heroHeadline).toBe('다낭·호이안 노팁·노옵션 바나힐 관광 3박5일');
    expect(copy.heroHeadline).not.toMatch(/BX|7315/);
  });

  it('turns weak promotion-only titles into meaningful travel titles', () => {
    const copy = buildCustomerPackageDisplayCopy({
      title: '★[쓰시마링크호] 7월10일 금요일 토요코인 자유석식 긴급특가',
      display_title: '긴급 특가!',
      destination: '대마도',
      duration: 2,
      nights: 1,
    });

    expect(copy.heroHeadline).toBe('대마도 선박 자유여행 1박2일');
    expect(copy.heroHeadline).not.toMatch(/긴급|특가|쓰시마링크/);
  });

  it('uses course and hotel facts when they are more useful than supplier codes', () => {
    const copy = buildCustomerPackageDisplayCopy({
      title: '[0729] VJ 다낭호캉스 5일 0626 발권',
      display_title: '【NO옵션/NO팁/NO쇼핑】 다낭 호캉스 패키지 바나힐 포함 5일',
      destination: '다낭',
      duration: 5,
      nights: 3,
      product_highlights: ['월드체인 5성호텔', '바나힐 테마파크'],
    });

    expect(copy.heroHeadline).toBe('다낭 노팁·노옵션 호캉스·바나힐 3박5일');
    expect(copy.heroHeadline).not.toMatch(/VJ|발권|패키지/);
  });

  it('keeps concise customer summaries and blocks internal wording', () => {
    const copy = buildCustomerPackageDisplayCopy({
      title: 'RMK NET 마진 정산 확인',
      destination: '장가계',
      duration: 5,
      nights: 4,
      product_summary: 'RMK NET 마진 정산 확인',
      product_highlights: ['노옵션', '천문산 케이블카', '특급호텔'],
    });

    expect(copy.heroHeadline).toBe('장가계 노옵션 특급호텔 4박5일');
    expect(copy.summaryBody).toContain('노옵션');
    expect(copy.summaryBody).not.toMatch(/RMK|NET|마진|정산/);
    expect(copy.issues).toContain('weak_product_summary');
  });

  it('does not repeat a course when it is already part of the destination label', () => {
    const copy = buildCustomerPackageDisplayCopy({
      title: '노쇼핑 대만 타이베이/단수이/예스지 3박4일',
      destination: '대만',
      duration: 4,
      nights: 3,
      product_highlights: ['노쇼핑', '예스지'],
    });

    expect(copy.heroHeadline).toBe('타이베이·예스지 노쇼핑 3박4일');
  });

  it('uses route and sales condition without promoting incidental itinerary perks as the title theme', () => {
    const copy = buildCustomerPackageDisplayCopy({
      title: '연길/백두산(북파+서파) 4박5일',
      display_title: '연길/백두산(북파+서파) 4박5일',
      destination: '연길',
      duration: 5,
      nights: 4,
      trip_style: '4박5일',
      product_highlights: ['연길 중심 일정', '5일 일정'],
      inclusions: ['준5성호텔숙박+온천욕', '특식4회'],
      optional_tours: [{ name: '노옵션' }],
    });

    expect(copy.heroHeadline).toBe('연길·백두산 노옵션 핵심관광 4박5일');
    expect(copy.heroHeadline).not.toContain('온천');
    expect(copy.badges).toEqual(expect.arrayContaining(['노옵션', '5성호텔']));
    expect(copy.badges).not.toContain('온천');
  });

  it('uses no-option evidence from exclusions and optional-tour fields across customer surfaces', () => {
    const copy = buildCustomerPackageDisplayCopy({
      title: 'LJ 연길 5성 온천 4박5일',
      destination: '연길',
      duration: 5,
      nights: 4,
      product_highlights: ['연길·백두산 핵심 관광'],
      inclusions: ['숙박료', '온천욕'],
      excludes: ['선택관광: 노옵션'],
      optional_tours: [{ name: '노옵션' }],
    });

    expect(copy.heroHeadline).toBe('연길·백두산 노옵션 핵심관광 4박5일');
    expect(copy.heroHeadline).not.toMatch(/LJ|온천|5성/);
    expect(copy.badges).toEqual(expect.arrayContaining(['노옵션']));
    expect(copy.badges).not.toContain('온천');
    expect(copy.badges).not.toContain('5성호텔');
    expect(copy.heroSubline).not.toMatch(/온천|5성/);
    expect(copy.summaryBody).not.toMatch(/온천|5성/);
  });

  it('uses onsen and hotel-grade badges only when non-title evidence supports them', () => {
    const copy = buildCustomerPackageDisplayCopy({
      title: '규슈 온천·관광 3박4일',
      destination: '규슈',
      duration: 4,
      nights: 3,
      product_highlights: ['쿠로카와 온천마을 산책'],
      inclusions: ['온천 료칸 숙박', '규슈 5성 호텔 또는 동급'],
      optional_tours: [{ name: '노옵션' }],
    });

    expect(copy.heroHeadline).toContain('온천');
    expect(copy.badges).toEqual(expect.arrayContaining(['노옵션', '5성호텔', '온천']));
    expect(copy.heroSubline).toMatch(/5성호텔|온천/);
  });
  it('shows customer-readable airline names instead of raw supplier airline codes', () => {
    const copy = buildCustomerPackageDisplayCopy({
      title: '[LJ] 다낭/호이안 노팁노옵션 3박5일',
      destination: '다낭/호이안',
      duration: 5,
      nights: 3,
      airline: 'LJ',
      product_highlights: ['LJ 항공 이용', '노옵션'],
    });

    expect(copy.badges).toContain('진에어');
    expect(copy.heroSubline).toContain('진에어');
    expect(copy.heroSubline).not.toMatch(/(^|[^A-Z0-9])LJ(?!\d|[A-Z0-9])/);
  });
});
