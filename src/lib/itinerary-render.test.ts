/**
 * itinerary-render 단위 테스트
 *
 * A4 포스터 + 모바일 랜딩 공용 — 선택관광 정규화 단일 진실 소스 (CRC).
 * 회귀 위험:
 *   - ERR-KUL-04: A4와 모바일에서 같은 데이터를 다르게 라벨링 → "쿠알라 야경 (말레이시아)" vs "쿠알라 야경"
 *   - region 필드 비어있을 때 이름에서 자동 추론 동작 보장
 */

import { describe, it, expect } from 'vitest';
import {
  type OptionalTourInput,
  normalizeOptionalTour,
  normalizeOptionalTourName,
  groupOptionalToursByRegion,
} from './itinerary-render';

describe('normalizeOptionalTour — region 추론 + 이름 정리', () => {
  it('명시 region 우선', () => {
    const r = normalizeOptionalTour({ name: '2층버스', region: '싱가포르' });
    expect(r.region).toBe('싱가포르');
    expect(r.displayName).toBe('2층버스 (싱가포르)');
  });

  it('이름 괄호에서 region 추출', () => {
    const r = normalizeOptionalTour({ name: '2층버스 (싱가포르)' });
    expect(r.region).toBe('싱가포르');
    expect(r.name).toBe('2층버스'); // base name (괄호 제거)
    expect(r.displayName).toBe('2층버스 (싱가포르)');
  });

  it('이름 본문에서 region 추출', () => {
    const r = normalizeOptionalTour({ name: '쿠알라 야경 투어' });
    expect(r.region).toBe('말레이시아'); // 쿠알라 → 말레이시아
  });

  it('region 추론 실패 → null + 괄호 없는 base name', () => {
    const r = normalizeOptionalTour({ name: '커피 투어' });
    expect(r.region).toBeNull();
    expect(r.displayName).toBe('커피 투어');
  });

  it('명시 region이 빈 문자열 → 이름에서 추론으로 폴백', () => {
    const r = normalizeOptionalTour({ name: '다낭 시티투어', region: '   ' });
    expect(r.region).toBe('베트남'); // 다낭 → 베트남
  });
});

describe('normalizeOptionalTour — 가격 통일', () => {
  it('price 문자열 우선', () => {
    const r = normalizeOptionalTour({ name: 'A', price: '$45/인' });
    expect(r.price).toBe('$45/인');
  });

  it('price_usd → "$N/인"', () => {
    const r = normalizeOptionalTour({ name: 'A', price_usd: 45 });
    expect(r.price).toBe('$45/인');
  });

  it('price_krw → "N,NNN원"', () => {
    const r = normalizeOptionalTour({ name: 'A', price_krw: 45_000 });
    expect(r.price).toBe('45,000원');
  });

  it('가격 0/null → null', () => {
    expect(normalizeOptionalTour({ name: 'A', price_usd: 0 }).price).toBeNull();
    expect(normalizeOptionalTour({ name: 'A' }).price).toBeNull();
  });

  it('price 우선 (price_usd 무시)', () => {
    const r = normalizeOptionalTour({ name: 'A', price: '무료', price_usd: 100 });
    expect(r.price).toBe('무료');
  });
});

describe('normalizeOptionalTour — 이름 본문 정리', () => {
  it('region 없는 일반 괄호는 보존', () => {
    // 괄호 안에 region 키워드가 없으면 stripRegionFromName이 건드리지 않음
    const r = normalizeOptionalTour({ name: '미니버스 (자유시간 1시간)' });
    // displayName 은 region이 추론될 수 있는지에 따라 다름
    // 이 케이스는 region 키워드 없음 → name 그대로
    expect(r.name).toContain('미니버스');
  });

  it('region 키워드 괄호는 base에서 제거', () => {
    const r = normalizeOptionalTour({ name: '나이트워크 (베트남)' });
    expect(r.name).toBe('나이트워크'); // 괄호 제거
    expect(r.region).toBe('베트남');
    expect(r.displayName).toBe('나이트워크 (베트남)'); // 재조립
  });

  it('note 보존', () => {
    const r = normalizeOptionalTour({ name: 'A', note: '  추가 비용 있음  ' });
    expect(r.note).toBe('추가 비용 있음'); // trim
  });
});

describe('normalizeOptionalTourName — 단일 라벨 (CRC 핵심)', () => {
  it('region 있으면 "(region)" 부착', () => {
    expect(normalizeOptionalTourName({ name: '2층버스', region: '싱가포르' }))
      .toBe('2층버스 (싱가포르)');
  });

  it('region 없으면 이름만', () => {
    expect(normalizeOptionalTourName({ name: '커피 투어' })).toBe('커피 투어');
  });

  it('A4와 모바일이 같은 입력 → 같은 출력 (ERR-KUL-04 차단)', () => {
    const input: OptionalTourInput = { name: '쿠알라 야경 투어' };
    const labelA = normalizeOptionalTourName(input); // A4
    const labelB = normalizeOptionalTourName(input); // 모바일
    expect(labelA).toBe(labelB);
    expect(labelA).toContain('말레이시아'); // 자동 추론
  });
});

describe('groupOptionalToursByRegion', () => {
  it('region 별 그룹핑', () => {
    const groups = groupOptionalToursByRegion([
      { name: '2층버스', region: '싱가포르' },
      { name: '쿠알라 야경' }, // 자동 추론 → 말레이시아
      { name: '말라카 시티' }, // 자동 추론 → 말레이시아
      { name: '신비의 투어' }, // region 없음
    ]);
    const map = new Map(groups.map(g => [g.region, g.tours]));
    expect(map.get('싱가포르')).toHaveLength(1);
    expect(map.get('말레이시아')).toHaveLength(2);
    expect(map.get('기타')).toHaveLength(1);
  });

  it('빈 배열 → []', () => {
    expect(groupOptionalToursByRegion([])).toEqual([]);
  });

  it('한 region만 있으면 그룹 1개', () => {
    const groups = groupOptionalToursByRegion([
      { name: 'A', region: '베트남' },
      { name: 'B', region: '베트남' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].region).toBe('베트남');
    expect(groups[0].tours).toHaveLength(2);
  });

  it('각 tour는 정규화된 객체 (displayName 포함)', () => {
    const groups = groupOptionalToursByRegion([
      { name: '2층버스 (싱가포르)' },
    ]);
    expect(groups[0].tours[0].displayName).toBe('2층버스 (싱가포르)');
    expect(groups[0].tours[0].name).toBe('2층버스');
  });
});
