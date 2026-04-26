/**
 * render-contract 순수 유틸 단위 테스트
 *
 * Load-bearing — A4 포스터 + 모바일 랜딩의 단일 진입점 (CRC).
 * 회귀 위험:
 *   - ERR-20260418-13/17 (getAirlineName): "BX793" / "BX(에어부산)" / "BX | 부산..." 모두 처리
 *   - ERR-20260418-26 (flattenItems): 괄호 내부 콤마는 분리 금지
 *   - ERR-FUK-comma-number (flattenItems): "2,000엔" 같은 숫자 콤마는 분리 금지
 *   - ERR-HET-single-charge-misclass (classifyExcludes): "싱글차지"는 surcharge 아님 (basic 유지)
 */

import { describe, it, expect } from 'vitest';
import {
  getAirlineName,
  parseFlightActivity,
  parseCityFromActivity,
  formatFlightLabel,
  flattenItems,
  classifyExcludes,
  SURCHARGE_RE,
} from './render-contract';

describe('getAirlineName', () => {
  it('null/empty → null', () => {
    expect(getAirlineName(null)).toBeNull();
    expect(getAirlineName(undefined)).toBeNull();
    expect(getAirlineName('')).toBeNull();
  });

  it('순수 IATA 코드 (BX → 에어부산)', () => {
    expect(getAirlineName('BX')).toBe('에어부산');
  });

  it('코드 + 숫자 (BX793 → 에어부산)', () => {
    expect(getAirlineName('BX793')).toBe('에어부산');
  });

  it('코드 + 괄호 한글명 (BX(에어부산) → 에어부산)', () => {
    expect(getAirlineName('BX(에어부산)')).toBe('에어부산');
  });

  it('코드 + 파이프 (BX | 부산-나트랑 → 에어부산)', () => {
    expect(getAirlineName('BX | 부산-나트랑')).toBe('에어부산');
  });

  it('알 수 없는 코드 + 괄호 한글 → 괄호값 사용', () => {
    expect(getAirlineName('XX(가상항공)')).toBe('가상항공');
  });

  it('알 수 없는 코드 + 한글 없음 → null', () => {
    expect(getAirlineName('XX999')).toBeNull();
  });

  it('digit-prefix IATA 코드 (7C → 제주항공) — 버그 수정 후 정상 매칭', () => {
    // 기존 구현: replace(/[0-9]/g, '') 가 prefix 숫자까지 strip → 매칭 실패.
    // 수정: replace(/\d+$/, '') 로 trailing 숫자(편명)만 제거.
    expect(getAirlineName('7C')).toBe('제주항공');
    expect(getAirlineName('7C123')).toBe('제주항공');
    expect(getAirlineName('5J')).toBe('세부퍼시픽');
    expect(getAirlineName('5J789')).toBe('세부퍼시픽');
  });

  it('소문자도 처리 (bx → 에어부산)', () => {
    expect(getAirlineName('bx')).toBe('에어부산');
  });
});

describe('parseFlightActivity', () => {
  it('null → 모두 null', () => {
    expect(parseFlightActivity(null)).toEqual({ depCity: null, arrCity: null, arrTime: null });
  });

  it('화살표 없음 → 모두 null', () => {
    expect(parseFlightActivity('BX792 비행기 탑승')).toEqual({ depCity: null, arrCity: null, arrTime: null });
  });

  it('도착 시각 추출: "도착 19:55"', () => {
    const r = parseFlightActivity('BX792 타이페이 출발 → 부산(김해) 도착 19:55');
    expect(r.arrTime).toBe('19:55');
  });

  it('"공항" 키워드가 있는 표준 포맷에서 출발지/시간 추출', () => {
    const r = parseFlightActivity('BX148 김해국제공항 출발 → 후쿠오카국제공항 08:25 도착');
    expect(r.depCity).toBe('김해');
    expect(r.arrTime).toBe('08:25');
    // arrCity 정규식이 "(?:국제)?공항?" 의 greedy 매칭으로 "후쿠오카국제" 까지 캡처 — 현 동작 락인
    expect(r.arrCity).toBe('후쿠오카국제');
  });

  it('"공항" 단어가 없으면 depCity 캡처 실패 (현 정규식 한계)', () => {
    // 코드 주석 예시 "BX792 타이페이 출발 → 부산(김해) 도착" 은 사실 매치 안 됨.
    // 정규식 `공항?` 가 "공항" 전체를 옵셔널로 만들지 않고 "항" 만 옵셔널 → "공" 없으면 fail.
    // 잠재 개선 후보지만 현 prod 동작 보존.
    const r = parseFlightActivity('BX792 타이페이 출발 → 부산(김해) 도착 19:55');
    expect(r.depCity).toBeNull();
  });
});

describe('parseCityFromActivity', () => {
  it('null → null', () => {
    expect(parseCityFromActivity(null)).toBeNull();
  });

  it('"인천국제공항 출발" → "인천"', () => {
    expect(parseCityFromActivity('인천국제공항 출발')).toBe('인천');
  });

  it('flight code prefix 제거: "BX792 타이페이공항"', () => {
    expect(parseCityFromActivity('BX792 타이페이공항 출발')).toBe('타이페이');
  });
});

describe('formatFlightLabel', () => {
  it('빈 입력 → 빈 문자열', () => {
    expect(formatFlightLabel(null)).toBe('');
    expect(formatFlightLabel('')).toBe('');
  });

  it('알려진 코드 → "에어부산 BX143"', () => {
    expect(formatFlightLabel('BX143')).toBe('에어부산 BX143');
  });

  it('알 수 없는 코드 → 원본 유지', () => {
    expect(formatFlightLabel('XX999')).toBe('XX999');
  });
});

describe('flattenItems — 콤마 분리 안전성', () => {
  it('단순 콤마 분리', () => {
    expect(flattenItems(['항공권, 호텔, 식사'])).toEqual(['항공권', '호텔', '식사']);
  });

  it('괄호 내부 콤마는 보호 (ERR-20260418-26)', () => {
    expect(flattenItems(['항공권 (인천, 부산 출발), 호텔'])).toEqual(['항공권 (인천, 부산 출발)', '호텔']);
  });

  it('숫자 천단위 콤마는 보호 (ERR-FUK-comma-number)', () => {
    expect(flattenItems(['엔터테인먼트 비용 2,000엔'])).toEqual(['엔터테인먼트 비용 2,000엔']);
  });

  it('숫자 콤마 + 일반 콤마 혼합', () => {
    expect(flattenItems(['수수료 1,500원, 가이드팁'])).toEqual(['수수료 1,500원', '가이드팁']);
  });

  it('SURCHARGE_RE 매치 항목은 분리하지 않고 trim만', () => {
    // "써차지 ($10/인/박)" 처럼 콤마 없어도 SURCHARGE 패턴 → 통째로 유지
    const r = flattenItems(['써차지, 추가요금']);
    // 이건 surcharge가 들어있으니 통째 유지
    expect(r).toEqual(['써차지, 추가요금']);
  });

  it('빈 항목 / 공백만 → 제외', () => {
    expect(flattenItems(['항공권, , 호텔'])).toEqual(['항공권', '호텔']);
  });
});

describe('classifyExcludes — basic vs surcharge', () => {
  it('순수 basic 항목', () => {
    const r = classifyExcludes(['가이드 팁', '개인 경비']);
    expect(r.basic).toEqual(['가이드 팁', '개인 경비']);
    expect(r.surcharges).toEqual([]);
  });

  it('써차지 키워드 포함 → surcharges', () => {
    const r = classifyExcludes(['써차지 ($10/인/박)', '가이드 팁']);
    expect(r.surcharges).toContain('써차지 ($10/인/박)');
    expect(r.basic).toContain('가이드 팁');
  });

  it('"의무디너" → surcharge', () => {
    const r = classifyExcludes(['의무디너 $30']);
    expect(r.surcharges).toContain('의무디너 $30');
  });

  it('금액 + 만원/원 단위 → surcharge', () => {
    const r = classifyExcludes(['추가 1만원']);
    expect(r.surcharges).toContain('추가 1만원');
  });

  it('"싱글차지"는 surcharge가 아니라 basic 유지 (ERR-HET-single-charge-misclass)', () => {
    const r = classifyExcludes(['싱글차지 (1인 1실 사용 시)']);
    // SURCHARGE_RE는 "싱글차지" 명시 제외 → basic으로
    expect(r.basic).toContain('싱글차지 (1인 1실 사용 시)');
    expect(r.surcharges).not.toContain('싱글차지 (1인 1실 사용 시)');
  });
});

describe('SURCHARGE_RE 직접', () => {
  it('"싱글차지" 미매치 (의도된 회피)', () => {
    expect(SURCHARGE_RE.test('싱글차지')).toBe(false);
  });

  it('"써차지" 매치', () => {
    expect(SURCHARGE_RE.test('하계 써차지')).toBe(true);
  });

  it('"$10" 매치', () => {
    expect(SURCHARGE_RE.test('$10/인/박')).toBe(true);
  });
});
