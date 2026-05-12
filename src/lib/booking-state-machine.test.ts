/**
 * booking-state-machine 단위 테스트
 *
 * 재무 직결 — 예약 상태 전이가 잘못되면 입금/완납/취소 로직 전체 깨짐.
 * 코드리뷰 08-IMPLEMENTATION A.2 의 patchStatus 가드 (admin/bookings/page.tsx) 가 의존.
 *
 * 커버:
 *   - ALLOWED_TRANSITIONS: 정방향 전이만 허용, 역방향/스킵 차단
 *   - isValidTransition: 게이트 함수 진위표
 *   - getStepIndex: progress bar 단계 (cancelled=-1, 레거시 confirmed=2/completed=4)
 *   - getStatusLabel / getStatusBadgeClass: 표시 라벨 일관성
 */

import { describe, it, expect } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  JOURNEY_STEPS,
  isValidTransition,
  getStepIndex,
  getStatusLabel,
  getStatusBadgeClass,
} from './booking-state-machine';

describe('JOURNEY_STEPS 순서', () => {
  it('step 인덱스가 0~4 연속', () => {
    const steps = JOURNEY_STEPS.map(s => s.step);
    expect(steps).toEqual([0, 1, 2, 3, 4]);
  });

  it('상태 순서: pending → waiting_deposit → deposit_paid → waiting_balance → fully_paid', () => {
    const statuses = JOURNEY_STEPS.map(s => s.status);
    expect(statuses).toEqual([
      'pending', 'waiting_deposit', 'deposit_paid', 'waiting_balance', 'fully_paid',
    ]);
  });
});

describe('ALLOWED_TRANSITIONS — 정방향 허용', () => {
  it('pending → waiting_deposit', () => {
    expect(isValidTransition('pending', 'waiting_deposit')).toBe(true);
  });

  it('waiting_deposit → deposit_paid', () => {
    expect(isValidTransition('waiting_deposit', 'deposit_paid')).toBe(true);
  });

  it('deposit_paid → waiting_balance', () => {
    expect(isValidTransition('deposit_paid', 'waiting_balance')).toBe(true);
  });

  it('waiting_balance → fully_paid', () => {
    expect(isValidTransition('waiting_balance', 'fully_paid')).toBe(true);
  });

  it('레거시 confirmed → waiting_balance', () => {
    expect(isValidTransition('confirmed', 'waiting_balance')).toBe(true);
  });
});

describe('ALLOWED_TRANSITIONS — 차단 케이스 (재무 사고 방지)', () => {
  it('역방향 전이 차단: deposit_paid → waiting_deposit', () => {
    expect(isValidTransition('deposit_paid', 'waiting_deposit')).toBe(false);
  });

  it('역방향 전이 차단: fully_paid → waiting_balance', () => {
    expect(isValidTransition('fully_paid', 'waiting_balance')).toBe(false);
  });

  it('단계 스킵 차단: pending → fully_paid', () => {
    expect(isValidTransition('pending', 'fully_paid')).toBe(false);
  });

  it('단계 스킵 차단: pending → deposit_paid', () => {
    expect(isValidTransition('pending', 'deposit_paid')).toBe(false);
  });

  it('완납에서 전이 없음 (terminal)', () => {
    expect(ALLOWED_TRANSITIONS['fully_paid']).toEqual([]);
  });

  it('취소에서 전이 없음 (terminal)', () => {
    expect(ALLOWED_TRANSITIONS['cancelled']).toEqual([]);
  });

  it('알 수 없는 상태에서 전이 시도 → false', () => {
    expect(isValidTransition('unknown_state', 'pending')).toBe(false);
  });
});

describe('전이 메타데이터', () => {
  it('pending → waiting_deposit eventType = DEPOSIT_NOTICE', () => {
    const t = ALLOWED_TRANSITIONS['pending'].find(x => x.to === 'waiting_deposit');
    expect(t?.eventType).toBe('DEPOSIT_NOTICE');
    expect(t?.logTitle).toBeTruthy();
  });

  it('waiting_deposit → deposit_paid 는 isMock = true (현재 테스트 모드)', () => {
    const t = ALLOWED_TRANSITIONS['waiting_deposit'].find(x => x.to === 'deposit_paid');
    expect(t?.isMock).toBe(true);
  });

  it('deposit_paid → waiting_balance eventType = BALANCE_NOTICE', () => {
    const t = ALLOWED_TRANSITIONS['deposit_paid'].find(x => x.to === 'waiting_balance');
    expect(t?.eventType).toBe('BALANCE_NOTICE');
  });

  it('waiting_balance → fully_paid eventType = BALANCE_CONFIRMED', () => {
    const t = ALLOWED_TRANSITIONS['waiting_balance'].find(x => x.to === 'fully_paid');
    expect(t?.eventType).toBe('BALANCE_CONFIRMED');
  });
});

describe('getStepIndex', () => {
  it('정상 단계 인덱스', () => {
    expect(getStepIndex('pending')).toBe(0);
    expect(getStepIndex('waiting_deposit')).toBe(1);
    expect(getStepIndex('deposit_paid')).toBe(2);
    expect(getStepIndex('waiting_balance')).toBe(3);
    expect(getStepIndex('fully_paid')).toBe(4);
  });

  it('cancelled = -1 (progress bar 표시 안 함)', () => {
    expect(getStepIndex('cancelled')).toBe(-1);
  });

  it('레거시 confirmed = 2 (≈ deposit_paid)', () => {
    expect(getStepIndex('confirmed')).toBe(2);
  });

  it('레거시 completed = 4 (≈ fully_paid)', () => {
    expect(getStepIndex('completed')).toBe(4);
  });

  it('알 수 없는 상태 → 0 (안전한 기본값)', () => {
    expect(getStepIndex('unknown')).toBe(0);
  });
});

describe('getStatusLabel', () => {
  it('표준 상태 한글 라벨', () => {
    expect(getStatusLabel('pending')).toBe('예약접수');
    expect(getStatusLabel('waiting_deposit')).toBe('계약금 대기');
    expect(getStatusLabel('fully_paid')).toBe('완납');
    expect(getStatusLabel('cancelled')).toBe('취소');
  });

  it('알 수 없는 상태 → 원본 그대로', () => {
    expect(getStatusLabel('unknown')).toBe('unknown');
  });
});

describe('getStatusBadgeClass', () => {
  it('cancelled = red', () => {
    expect(getStatusBadgeClass('cancelled')).toContain('red');
  });

  it('fully_paid / completed = green', () => {
    expect(getStatusBadgeClass('fully_paid')).toContain('green');
    expect(getStatusBadgeClass('completed')).toContain('green');
  });

  it('알 수 없는 상태 → 회색 fallback', () => {
    expect(getStatusBadgeClass('unknown')).toContain('gray');
  });
});

describe('상태머신 종단성 (terminal states)', () => {
  it('fully_paid 에서는 어떤 상태로도 자동 전이 불가 (cancelled 는 별도 분기)', () => {
    expect(isValidTransition('fully_paid', 'pending')).toBe(false);
    expect(isValidTransition('fully_paid', 'waiting_balance')).toBe(false);
    expect(isValidTransition('fully_paid', 'cancelled')).toBe(false); // ALLOWED_TRANSITIONS 에는 없음 (admin UI 가 별도 처리)
  });

  it('cancelled 에서 다른 상태로 자동 전이 없음', () => {
    expect(isValidTransition('cancelled', 'pending')).toBe(false);
    expect(isValidTransition('cancelled', 'fully_paid')).toBe(false);
  });
});
