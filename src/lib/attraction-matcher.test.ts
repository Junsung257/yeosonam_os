/**
 * attraction-matcher 단위 테스트
 *
 * Load-bearing — A4 포스터·모바일 랜딩·블로그 큐레이션·PackagesClient 이미지 매핑이 공유.
 * 회귀 위험:
 *   - ERR-LB-DAD-keyword-spillover (2026-04-20): "호이안" 같은 도시명 단독으로 모든 호이안 activity에
 *     "호이안 바구니배"가 잘못 붙는 사고. MATCH_STOP_WORDS 확장으로 해결.
 *   - SKIP_PATTERN: 조식/투숙/이동 등 비관광 활동은 매칭 시도 자체 차단.
 *   - normalizeDays: itinerary_data 듀얼 포맷 (배열 vs {days:[]}) 양쪽 지원.
 *   - WeakMap 캐시: 같은 attractions 배열 + 같은 destination 반복 호출 시 인덱스 재사용.
 */

import { describe, it, expect } from 'vitest';
import {
  type AttractionData,
  buildAttractionIndex,
  matchAttraction,
  matchAttractionIndexed,
  matchAttractions,
  normalizeDays,
} from './attraction-matcher';

const attr = (overrides: Partial<AttractionData> & { name: string }): AttractionData => ({
  ...overrides,
});

const sampleAttractions: AttractionData[] = [
  attr({ name: '메르데카 광장', region: '쿠알라룸푸르', country: '말레이시아', aliases: ['Merdeka Square'] }),
  attr({ name: '호이안 바구니배', region: '호이안', country: '베트남' }),
  attr({ name: '호이안 야경', region: '호이안', country: '베트남' }),
  attr({ name: '오타루운하', region: '오타루', country: '일본', aliases: ['오타루 운하'] }),
  attr({ name: '키타이치가라스', region: '오타루', country: '일본' }),
  attr({ name: '나트랑 진흙온천', region: '나트랑', country: '베트남' }),
];

describe('normalizeDays', () => {
  it('null/undefined → []', () => {
    expect(normalizeDays(null)).toEqual([]);
    expect(normalizeDays(undefined)).toEqual([]);
  });

  it('배열 그대로 반환', () => {
    const arr = [{ day: 1 }, { day: 2 }];
    expect(normalizeDays(arr)).toBe(arr);
  });

  it('{days: [...]} 객체 → 배열 추출', () => {
    const arr = [{ day: 1 }, { day: 2 }];
    expect(normalizeDays({ days: arr })).toBe(arr);
  });

  it('{days 누락} 객체 → []', () => {
    expect(normalizeDays({} as { days?: unknown[] })).toEqual([]);
  });

  it('JSON 문자열 → days 파싱', () => {
    const arr = [{ day: 1, schedule: [] }];
    expect(normalizeDays(JSON.stringify({ days: arr }))).toEqual(arr);
  });

  it('day_list 비표준 키 → 배열 추출', () => {
    const arr = [{ day: 1 }];
    expect(normalizeDays({ day_list: arr } as { day_list: typeof arr })).toEqual(arr);
  });
});

describe('matchAttraction — 기본 매칭', () => {
  it('정확한 이름 매칭', () => {
    const r = matchAttraction('메르데카 광장', sampleAttractions, '쿠알라룸푸르');
    expect(r?.name).toBe('메르데카 광장');
  });

  it('alias 정확 매칭', () => {
    const r = matchAttraction('Merdeka Square', sampleAttractions);
    expect(r?.name).toBe('메르데카 광장');
  });

  it('attractions가 비어있으면 null', () => {
    expect(matchAttraction('아무거나', [])).toBeNull();
  });

  it('빈 activity → null', () => {
    expect(matchAttraction('', sampleAttractions)).toBeNull();
  });

  it('긴 이름이 짧은 이름보다 먼저 매칭 (메르데카 광장 vs 광장)', () => {
    const r = matchAttraction('메르데카 광장 방문', sampleAttractions, '쿠알라룸푸르');
    expect(r?.name).toBe('메르데카 광장');
  });
});

describe('SKIP_PATTERN — 비관광 활동 차단', () => {
  it('조식 → null', () => {
    expect(matchAttraction('호텔 조식', sampleAttractions)).toBeNull();
  });

  it('호텔 투숙 → null', () => {
    expect(matchAttraction('호텔 투숙 휴식', sampleAttractions)).toBeNull();
  });

  it('공항 이동 → null', () => {
    expect(matchAttraction('공항 이동', sampleAttractions)).toBeNull();
  });

  it('자유시간 → null', () => {
    expect(matchAttraction('자유시간', sampleAttractions)).toBeNull();
  });
});

describe('MATCH_STOP_WORDS — 도시명 spillover 방지 (ERR-LB-DAD-keyword-spillover)', () => {
  it('"호이안" 단독 키워드는 "호이안 바구니배" 매칭 트리거 안 됨', () => {
    // 다른 호이안 activity에 "호이안 바구니배"가 잘못 붙는 사고 재현 방지
    const r = matchAttraction('호이안', sampleAttractions, '베트남/호이안');
    // STOP_WORDS에 "호이안" 포함 → null 반환 또는 다른 매칭 (어느 쪽이든 "호이안 바구니배"는 아님)
    expect(r?.name).not.toBe('호이안 바구니배');
  });

  it('"광장" 단독은 어떤 광장에도 매칭 안 됨', () => {
    const r = matchAttraction('광장 산책', sampleAttractions, '쿠알라룸푸르');
    // STOP_WORDS에 "광장" 있음 → 단독으로는 매칭 차단
    expect(r).toBeNull();
  });

  it('하지만 "메르데카 광장 야경"처럼 구체 키워드가 있으면 매칭', () => {
    const r = matchAttraction('메르데카 광장 야경', sampleAttractions, '쿠알라룸푸르');
    expect(r?.name).toBe('메르데카 광장');
  });
});

describe('matchAttractions — 콤마 분리 다중 매칭', () => {
  it('▶ 접두사 + 콤마 분리 (오타루운하, 키타이치가라스)', () => {
    const r = matchAttractions('▶오타루운하, 키타이치가라스', sampleAttractions, '일본/오타루');
    const names = r.map(a => a.name);
    expect(names).toContain('오타루운하');
    expect(names).toContain('키타이치가라스');
  });

  it('단일 매칭은 배열 1개', () => {
    const r = matchAttractions('나트랑 진흙온천', sampleAttractions, '나트랑');
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('나트랑 진흙온천');
  });

  it('매칭 0건 → []', () => {
    const r = matchAttractions('완전 알 수 없는 곳', sampleAttractions);
    expect(r).toEqual([]);
  });

  it('말미 괄호 (비고) 제거 후 분리', () => {
    const r = matchAttractions('오타루운하, 키타이치가라스 (사진찍기)', sampleAttractions, '일본/오타루');
    const names = r.map(a => a.name);
    expect(names).toContain('오타루운하');
    expect(names).toContain('키타이치가라스');
  });
});

describe('buildAttractionIndex / matchAttractionIndexed', () => {
  it('인덱스 사전 구축 후 반복 매칭은 동일 결과', () => {
    const idx = buildAttractionIndex(sampleAttractions, '베트남/호이안');
    const r1 = matchAttractionIndexed('호이안 야경', idx);
    const r2 = matchAttractionIndexed('호이안 야경', idx);
    expect(r1?.name).toBe('호이안 야경');
    expect(r2).toBe(r1); // 같은 attraction 객체 참조
  });

  it('substringList는 이름 길이 DESC 정렬', () => {
    const idx = buildAttractionIndex(sampleAttractions);
    const lens = idx.substringList.map(a => a.name?.length ?? 0);
    for (let i = 1; i < lens.length; i++) {
      expect(lens[i - 1]).toBeGreaterThanOrEqual(lens[i]);
    }
  });

  it('destination 필터: country 일치 항목 포함', () => {
    const idx = buildAttractionIndex(sampleAttractions, '베트남');
    const names = idx.filtered.map(a => a.name);
    expect(names).toContain('호이안 바구니배');
    expect(names).toContain('나트랑 진흙온천');
  });
});

describe('WeakMap 캐시 동작', () => {
  it('같은 attractions 배열 반복 호출 시 안전하게 동작 (캐시 없으면 동일 결과 보장)', () => {
    const r1 = matchAttraction('메르데카 광장', sampleAttractions, '쿠알라룸푸르');
    const r2 = matchAttraction('메르데카 광장', sampleAttractions, '쿠알라룸푸르');
    expect(r2).toBe(r1);
  });

  it('다른 destination은 별도 인덱스로 동작', () => {
    const r1 = matchAttraction('호이안 야경', sampleAttractions, '베트남');
    const r2 = matchAttraction('호이안 야경', sampleAttractions, '말레이시아');
    expect(r1?.name).toBe('호이안 야경');
    // destination=말레이시아 필터에 호이안 attraction은 빠지므로 null 또는 다른 결과
    expect(r2?.name).not.toBe('호이안 야경');
  });
});
