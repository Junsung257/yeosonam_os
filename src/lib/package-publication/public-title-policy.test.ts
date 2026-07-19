import { describe, expect, it } from 'vitest';

import { composeCustomerPublicTitle } from './public-title-policy';
import { buildPublicPackageSnapshot } from './public-snapshot';

describe('customer public title policy', () => {
  it('builds Yanji/Baekdu title from destination, no-option evidence, core tourism, and duration', () => {
    const title = composeCustomerPublicTitle({
      destination: '연길',
      title: '연길 5성 온천 4박5일',
      duration: 5,
      nights: 4,
      raw_text: [
        '선택관광: 노옵션',
        'DAY 2 백두산 천지 관광',
        '온천욕으로 휴식',
      ].join('\n'),
    });

    expect(title).toBe('연길·백두산 노옵션 핵심관광 4박5일');
    expect(title).not.toContain('온천');
    expect(title).not.toContain('5성');
  });

  it('removes supplier codes and risky departure words from Da Nang/Hoi An titles', () => {
    const title = composeCustomerPublicTitle({
      destination: '다낭/호이안',
      title: '[LJ] 다낭/호이안 노팁노옵션 3박5일 출발확정 스팟특가',
      duration: 5,
      nights: 3,
      raw_text: '호이안 야경 관광, 바나힐 관광, 리조트 휴양 일정 포함',
    });

    expect(title).toBe('다낭·호이안 노팁·노옵션 휴양관광 3박5일');
    expect(title).not.toMatch(/LJ|출발확정|특가/);
  });

  it('uses 5-star hotel in the title only when hotel-grade evidence exists', () => {
    const title = composeCustomerPublicTitle({
      destination: '나트랑/달랏',
      title: '나트랑/달랏 5성 3박5일',
      duration: 5,
      nights: 3,
      accommodations: ['나트랑 5성 호텔', '달랏 5성 호텔'],
      raw_text: '나트랑 시내 관광과 달랏 핵심 관광을 진행합니다.',
    });

    expect(title).toBe('나트랑·달랏 5성호텔 핵심관광 3박5일');
  });

  it('does not promote a raw 5-star word into the title without hotel evidence', () => {
    const title = composeCustomerPublicTitle({
      destination: '나트랑/달랏',
      title: '나트랑/달랏 5성 3박5일',
      duration: 5,
      nights: 3,
      raw_text: '나트랑 시내 관광과 달랏 핵심 관광을 진행합니다.',
    });

    expect(title).toBe('나트랑·달랏 핵심관광 3박5일');
    expect(title).not.toContain('5성');
  });

  it('uses onsen as a title theme only for a trip-level onsen itinerary', () => {
    const title = composeCustomerPublicTitle({
      destination: '북해도',
      title: '북해도 온천 3박4일',
      duration: 4,
      nights: 3,
      itinerary_data: {
        days: [
          { day: 1, hotel: { name: '노보리베츠 온천호텔' } },
          { day: 2, schedule: [{ activity: '죠잔케이 온천마을 관광' }] },
        ],
      },
    });

    expect(title).toBe('북해도 온천·관광 3박4일');
  });

  it('does not promote one mud-onsen activity into a trip-level title theme', () => {
    const title = composeCustomerPublicTitle({
      destination: '나트랑/달랏',
      title: '나트랑 달랏 3박5일',
      duration: 5,
      nights: 3,
      raw_text: '나트랑 시내 관광과 머드온천 체험, 달랏 관광 일정입니다.',
      itinerary_data: {
        days: [
          {
            day: 2,
            schedule: [
              {
                activity: '베트남에서 유명한 머드온천 체험',
                landing_sentence: '베트남에서 유명한 머드온천 일정을 진행합니다.',
              },
            ],
          },
        ],
      },
    });

    expect(title).toBe('나트랑·달랏 핵심관광 3박5일');
    expect(title).not.toContain('온천');
  });

  it('does not promote a single onsen sightseeing mention into a trip-level title theme', () => {
    const title = composeCustomerPublicTitle({
      destination: '\uC77C\uBCF8 \uBD81\uC54C\uD504\uC2A4, \uB3D9\uACBD, \uC54C\uD39C\uB8E8\uD2B8, \uD558\uCF54\uB124',
      title: '\uC77C\uBCF8\uC758 \uBD81\uC54C\uD504\uC2A4 \uB3D9\uACBD \uC54C\uD39C\uB8E8\uD2B8 \uD558\uCF54\uB124 4\uC77C PKG',
      duration: 4,
      nights: 3,
      raw_text: '\uD558\uCF54\uB124 \uC628\uCC9C \uAD00\uAD11 \uD6C4 \uB3D9\uACBD \uC2DC\uB0B4 \uAD00\uAD11\uC744 \uC9C4\uD589\uD569\uB2C8\uB2E4.',
    });

    expect(title).not.toContain('\uC628\uCC9C');
  });

  it('does not promote Yanji/Baekdu onsen wording into the title theme', () => {
    const title = composeCustomerPublicTitle({
      destination: '연길',
      title: '0810,21 ★BX연길백두산(서,북파)패키지 0630TL',
      duration: 4,
      nights: 3,
      raw_text: [
        '노팁 노옵션',
        '백두산 서파 북파 핵심 관광',
        '온천 관광과 온천욕 포함',
      ].join('\n'),
    });

    expect(title).toBe('연길·백두산 노팁·노옵션 핵심관광 3박4일');
    expect(title).not.toContain('온천');
  });

  it('keeps Nagasaki golf as Nagasaki instead of widening it to Fukuoka/Kyushu', () => {
    const title = composeCustomerPublicTitle({
      destination: '나가사키',
      title: 'BX나가사키 파라다이스 골프 패키지 54H 3박4일',
      duration: 4,
      nights: 3,
      raw_text: '나가사키 골프장 54홀 라운드 일정. 후쿠오카 공항 이용 가능.',
    });

    expect(title).toBe('나가사키 골프 3박4일');
    expect(title).not.toContain('후쿠오카·규슈');
  });

  it('removes product conditions from destination before composing the title', () => {
    const title = composeCustomerPublicTitle({
      destination: '노팁/노옵션 특급호텔 청도+맥주박물관',
      title: '노팁/노옵션 특급호텔 BX 청도+맥주박물관 2박3일',
      duration: 3,
      nights: 2,
      raw_text: '노팁 노옵션. 청도 맥주박물관 핵심 관광 일정.',
    });

    expect(title).toBe('청도 노팁·노옵션 핵심관광 2박3일');
    expect(title).not.toContain('특급호텔');
    expect(title.match(/노팁·노옵션/g)).toHaveLength(1);
  });

  it('keeps Bohol as the public destination even when Cebu appears in surrounding itinerary text', () => {
    const title = composeCustomerPublicTitle({
      destination: '보홀',
      title: '요금표] 보홀 7C 부산출발 26년 헤난 여름휴가특가',
      duration: 5,
      nights: 3,
      raw_text: '보홀 리조트 휴양 일정. 세부 공항 이동 후 보홀 숙소로 이동합니다.',
    });

    expect(title).toBe('보홀 휴양관광 3박5일');
    expect(title).not.toContain('세부');
  });

  it('keeps Hong Kong as the destination when surrounding copy mentions detailed conditions', () => {
    const title = composeCustomerPublicTitle({
      destination: '홍콩',
      title: '홍IN/OUT 홍콩똑딱 2박4일 UO',
      duration: 4,
      nights: 2,
      raw_text: '예약 가능 여부와 세부 조건은 상담 후 확인됩니다. 홍콩 자유일정과 항공 조건을 확인합니다.',
    });

    expect(title).toBe('홍콩 자유일정 2박4일');
    expect(title).not.toContain('세부');
    expect(title).not.toContain('휴양관광');
  });

  it('prefers the explicit source duration when package nights are inferred incorrectly', () => {
    const title = composeCustomerPublicTitle({
      destination: '란주',
      title: '란주 황하석림 바단지린 칠채산 4박6일',
      duration: 6,
      nights: 5,
      raw_text: '란주 황하석림 바단지린 칠채산 핵심 관광 일정입니다.',
    });

    expect(title).toBe('란주 핵심관광 4박6일');
  });

  it('sums segmented source nights before composing a public title duration', () => {
    const title = composeCustomerPublicTitle({
      destination: '북해도',
      title: '이스타 부산 북해도 정통 온천 2박 시내 1박 4일',
      duration: 4,
      nights: 1,
      raw_text: [
        '북해도 정통 온천 2박',
        '삿포로 시내 1박',
        '전체 4일 일정',
        '온천 호텔과 온천마을 관광 포함',
      ].join('\n'),
    });

    expect(title).toBe('북해도 온천·관광 3박4일');
    expect(title).not.toContain('1박4일');
  });

  it('does not let long operational source text override a clear standard duration', () => {
    const title = composeCustomerPublicTitle({
      destination: '연길/백두산',
      title: '연길/백두산(북파) 2박3일',
      duration: 3,
      nights: 2,
      raw_text: [
        '6/11(목) 까지 항공권 발권조건 2명부터 출발확정',
        'DAY 1 연길 이동',
        'DAY 2 백두산 북파 관광',
        'DAY 3 귀국',
        '14일 전 취소 규정과 운영 안내는 고객 제목 근거가 아닙니다.',
      ].join('\n'),
    });

    expect(title).toBe('연길·백두산 핵심관광 2박3일');
    expect(title).not.toContain('6박14일');
  });

  it('does not treat KLCC as golf course evidence', () => {
    const title = composeCustomerPublicTitle({
      destination: '쿠알라룸푸르/싱가포르/말라카',
      title: '쿠알라룸푸르 싱가포르 말라카 3박 5일 — 에어아시아 직항',
      duration: 5,
      nights: 3,
      product_highlights: ['5성급 호텔 숙박', '쿠알라+싱가포르+말라카 3개 도시 동시 체험'],
      itinerary_data: {
        days: [
          {
            day: 1,
            hotel: { grade: '5성' },
            schedule: [
              { activity: 'KLCC 외관 관광' },
              { activity: '포포인츠 쉐라톤 쿠알라 또는 동급 5성급 투숙' },
            ],
          },
        ],
      },
    });

    expect(title).toBe('쿠알라룸푸르·싱가포르·말라카 5성호텔 핵심관광 3박5일');
    expect(title).not.toContain('골프');
  });

  it('routes readable Korean package input through the public snapshot builder', () => {
    const { snapshot } = buildPublicPackageSnapshot({
      id: 'golden-danang',
      package_revision: 1,
      destination: '다낭/호이안',
      title: '[LJ] 다낭/호이안 노팁노옵션 3박5일 출발확정',
      duration: 5,
      nights: 3,
      price_dates: [{ date: '2026-08-01', price: 799000 }],
      product_prices: [{ target_date: '2026-08-01', adult_selling_price: 799000 }],
      raw_text: '노팁 노옵션 조건. 호이안 야경 관광과 리조트 휴양 일정 포함.',
      products: {
        thumbnail_urls: ['https://cdn.yeosonam.com/packages/danang.jpg'],
      },
      itinerary_data: { days: [{ day: 1, schedule: [{ activity: '호이안 야경 관광' }] }] },
    });

    expect(snapshot.public_title).toBe('다낭·호이안 노팁·노옵션 휴양관광 3박5일');
    expect(snapshot.package.title).toBe(snapshot.public_title);
    expect(snapshot.route_text_dump.join('\n')).not.toMatch(/LJ|출발확정/);
  });
});
