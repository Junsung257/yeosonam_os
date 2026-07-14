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
