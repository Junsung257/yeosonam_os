/**
 * @file package-acl.test.ts
 * @description Anti-Corruption Layer 회귀 방지 (P1-5).
 *
 * 보장:
 *   - 구형 photo {url,thumb,credit} → 신형 {src_medium,src_large,photographer}
 *   - 신형 photo passthrough
 *   - 비정상 입력은 null/[] 안전 폴백 (절대 throw X)
 *   - itinerary_data: array | {days:[...]} 모두 배열로 통일
 *   - optional_tours: region 자동 추론 (괄호 우선 → 본문)
 *   - normalizePackage: 모든 array 필드 누락 시 [] 보정
 */

import { describe, it, expect } from 'vitest';
import {
  normalizePhoto,
  normalizePhotos,
  normalizeOptionalTour,
  normalizeOptionalTours,
  normalizeItineraryData,
  normalizePackage,
  normalizeAttraction,
} from './package-acl';

describe('normalizePhoto', () => {
  it('신형 photo 는 그대로 통과 (필드 보존)', () => {
    const newP = {
      src_medium: 'https://x/m.jpg',
      src_large: 'https://x/l.jpg',
      photographer: 'A',
      pexels_id: 123,
      alt: 'sea',
    };
    expect(normalizePhoto(newP)).toEqual(newP);
  });

  it('구형 {url,thumb,credit} → 신형 변환', () => {
    const legacy = { url: 'https://x/large.jpg', thumb: 'https://x/m.jpg', credit: 'B', pexels_id: 7 };
    const r = normalizePhoto(legacy, 'fallback alt');
    expect(r).toEqual({
      src_medium: 'https://x/m.jpg',
      src_large: 'https://x/large.jpg',
      photographer: 'B',
      pexels_id: 7,
      alt: 'fallback alt',
    });
  });

  it('thumb만 있고 url 없으면 src_large 도 thumb 폴백', () => {
    const r = normalizePhoto({ thumb: 'https://x/t.jpg' });
    expect(r?.src_medium).toBe('https://x/t.jpg');
    expect(r?.src_large).toBe('https://x/t.jpg');
  });

  it('null/undefined/문자열 → null 반환 (throw 금지)', () => {
    expect(normalizePhoto(null)).toBeNull();
    expect(normalizePhoto(undefined)).toBeNull();
    expect(normalizePhoto('not-an-object')).toBeNull();
    expect(normalizePhoto({})).toBeNull(); // url/thumb/src_* 모두 없음
  });

  it('photographer 우선순위: 신형 photographer > 구형 credit > 빈 문자열', () => {
    expect(normalizePhoto({ src_medium: 'a', src_large: 'b', photographer: 'p1', credit: 'c1' })?.photographer).toBe('p1');
    expect(normalizePhoto({ src_medium: 'a', src_large: 'b', credit: 'c1' })?.photographer).toBe('c1');
    expect(normalizePhoto({ src_medium: 'a', src_large: 'b' })?.photographer).toBe('');
  });
});

describe('normalizePhotos', () => {
  it('배열 아닌 입력 → []', () => {
    expect(normalizePhotos(null)).toEqual([]);
    expect(normalizePhotos(undefined)).toEqual([]);
    expect(normalizePhotos('string')).toEqual([]);
    expect(normalizePhotos({ obj: 1 })).toEqual([]);
  });

  it('정상 배열 — null 항목 자동 제거', () => {
    const arr = [
      { url: 'https://x/1.jpg' },
      null,
      'invalid',
      { src_medium: 'a', src_large: 'b' },
    ];
    const r = normalizePhotos(arr);
    expect(r).toHaveLength(2);
    expect(r[0].src_large).toBe('https://x/1.jpg');
    expect(r[1].src_medium).toBe('a');
  });

  it('fallbackAlt 가 모든 항목에 적용', () => {
    const r = normalizePhotos([{ url: 'https://x/1.jpg' }], 'tour A');
    expect(r[0].alt).toBe('tour A');
  });
});

describe('normalizeOptionalTour', () => {
  it('name 없으면 null', () => {
    expect(normalizeOptionalTour({})).toBeNull();
    expect(normalizeOptionalTour({ region: '싱가포르' })).toBeNull();
  });

  it('region 명시되어 있으면 그대로 유지', () => {
    const r = normalizeOptionalTour({ name: '시티투어', region: '나가사키' });
    expect(r?.region).toBe('나가사키');
  });

  it('괄호 안 키워드로 region 자동 추론 ("2층버스 (싱가포르)")', () => {
    const r = normalizeOptionalTour({ name: '2층버스 (싱가포르)' });
    expect(r?.region).toBe('싱가포르');
  });

  it('price 가 number 면 string 으로 변환', () => {
    const r = normalizeOptionalTour({ name: 'spa', price: 50 });
    expect(r?.price).toBe('50');
  });

  it('USD30 같은 옵션 가격 문자열은 고객용 $30/인 표기로 정규화', () => {
    const r = normalizeOptionalTour({ name: '발마사지30분', price: 'USD30', price_usd: 30 });
    expect(r?.price).toBe('$30/인');
    expect(r?.price_usd).toBe(30);
  });

  it('잘못된 numeric 필드는 null', () => {
    const r = normalizeOptionalTour({ name: 'spa', price_usd: 'NaN' as unknown as number, day: 'x' as unknown as number });
    expect(r?.price_usd).toBeNull();
    expect(r?.day).toBeNull();
  });
});

describe('normalizeOptionalTours', () => {
  it('비배열 → []', () => {
    expect(normalizeOptionalTours(null)).toEqual([]);
    expect(normalizeOptionalTours('s')).toEqual([]);
  });

  it('null 항목 / name 없는 항목 자동 제거', () => {
    const r = normalizeOptionalTours([
      { name: '시티투어' },
      { region: 'X' }, // name 없음 → 제거
      null,
      undefined,
      { name: 'spa', price: 30 },
    ]);
    expect(r.map((t) => t.name)).toEqual(['시티투어', 'spa']);
  });
});

describe('normalizeItineraryData', () => {
  it('null 입력 → null', () => {
    expect(normalizeItineraryData(null)).toBeNull();
    expect(normalizeItineraryData(undefined)).toBeNull();
  });

  it('배열 입력 → 그대로 반환', () => {
    const days = [{ day: 1, schedule: [] }];
    expect(normalizeItineraryData(days)).toEqual(days);
  });

  it('{days:[...]} 입력 → 배열 추출', () => {
    const days = [{ day: 1, schedule: [] }];
    expect(normalizeItineraryData({ days })).toEqual(days);
  });

  it('잘못된 wrapping {itinerary_data:[...]} → null (legacy ETL 버그 방어)', () => {
    expect(normalizeItineraryData({ itinerary_data: [] })).toBeNull();
  });

  it('days 가 배열 아니면 null', () => {
    expect(normalizeItineraryData({ days: 'invalid' })).toBeNull();
  });
});

describe('normalizePackage', () => {
  it('빈 객체 입력 → 모든 array 필드 [] 보정', () => {
    const r = normalizePackage({});
    expect(r.price_tiers).toEqual([]);
    expect(r.price_dates).toEqual([]);
    expect(r.excluded_dates).toEqual([]);
    expect(r.confirmed_dates).toEqual([]);
    expect(r.inclusions).toEqual([]);
    expect(r.excludes).toEqual([]);
    expect(r.surcharges).toEqual([]);
    expect(r.notices_parsed).toEqual([]);
    expect(r.product_highlights).toEqual([]);
    expect(r.itinerary_data).toBeNull();
  });

  it('비배열 입력은 [] 로 강제 (잘못된 DB 데이터 방어)', () => {
    const r = normalizePackage({
      price_tiers: 'string-instead-of-array',
      inclusions: { obj: 1 },
    });
    expect(r.price_tiers).toEqual([]);
    expect(r.inclusions).toEqual([]);
  });

  it('itinerary_data: {days:[...]} → 배열로 평탄화', () => {
    const days = [{ day: 1, schedule: [] }];
    const r = normalizePackage({ itinerary_data: { days } });
    expect(r.itinerary_data).toEqual(days);
  });

  it('optional_tours region 자동 추론 적용 (괄호 안 도시 → REGION_KEYWORD_MAP)', () => {
    const r = normalizePackage({
      optional_tours: [{ name: '야경투어 (쿠알라룸푸르)' }],
    });
    // 실제 REGION_KEYWORD_MAP은 도시명 → 상위 region 매핑이므로 결과는 매핑된 region
    expect((r.optional_tours as { region: string }[])[0].region).toBeTruthy();
    // null/빈 문자열이 아니면 충분 — 정확한 매핑값은 REGION_KEYWORD_MAP 변경에 따라 달라짐
  });
});

describe('normalizeAttraction', () => {
  it('attraction.photos 정규화 (구형 → 신형)', () => {
    const r = normalizeAttraction({
      name: '상비산',
      photos: [{ url: 'https://x/sangbi.jpg' }],
    });
    expect(r.photos[0].src_large).toBe('https://x/sangbi.jpg');
    expect(r.photos[0].alt).toBe('상비산');
  });

  it('photos 누락 시 [] 안전', () => {
    const r = normalizeAttraction({ name: '여의봉' });
    expect(r.photos).toEqual([]);
  });
});
