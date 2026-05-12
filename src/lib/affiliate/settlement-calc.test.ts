/**
 * settlement-calc 단위 테스트
 *
 * 재무 직결 — 정산 기안 크론(매월 1일 02:00)이 사용. 회귀 시 정산 사고.
 *
 * 커버:
 *   - resolvePreviousPeriod: 이전 달 계산 (year rollover, 윤년, 월말 경계)
 *
 * 비커버 (DB 모킹 필요):
 *   - calculateDraftForAffiliate (Promise.all 병렬 쿼리 결합)
 *   - applySettlementApproval
 */

import { describe, it, expect } from 'vitest';
import { resolvePreviousPeriod } from './settlement-calc';

describe('resolvePreviousPeriod', () => {
  it('2026-04-15 → 2026-03 기간 반환', () => {
    const r = resolvePreviousPeriod(new Date('2026-04-15T10:00:00Z'));
    expect(r.period).toBe('2026-03');
    expect(r.periodStart).toBe('2026-03-01');
    expect(r.periodEnd).toBe('2026-03-31');
  });

  it('1월 → 작년 12월 (year rollover)', () => {
    const r = resolvePreviousPeriod(new Date('2026-01-05T10:00:00Z'));
    expect(r.period).toBe('2025-12');
    expect(r.periodStart).toBe('2025-12-01');
    expect(r.periodEnd).toBe('2025-12-31');
  });

  it('3월 → 2월 마지막 날 (윤년 2024)', () => {
    const r = resolvePreviousPeriod(new Date('2024-03-10T10:00:00Z'));
    expect(r.period).toBe('2024-02');
    expect(r.periodEnd).toBe('2024-02-29'); // 윤년
  });

  it('3월 → 2월 마지막 날 (평년 2025)', () => {
    const r = resolvePreviousPeriod(new Date('2025-03-10T10:00:00Z'));
    expect(r.period).toBe('2025-02');
    expect(r.periodEnd).toBe('2025-02-28');
  });

  it('5월 → 4월 마지막 날 30일', () => {
    const r = resolvePreviousPeriod(new Date('2026-05-01T10:00:00Z'));
    expect(r.period).toBe('2026-04');
    expect(r.periodEnd).toBe('2026-04-30');
  });

  it('todayIso는 입력 날짜의 YYYY-MM-DD', () => {
    const r = resolvePreviousPeriod(new Date('2026-04-27T15:30:00Z'));
    expect(r.todayIso).toBe('2026-04-27');
  });

  it('period는 zero-padded MM 포맷', () => {
    const r = resolvePreviousPeriod(new Date('2026-02-15T10:00:00Z'));
    expect(r.period).toBe('2026-01'); // 01, not 1
  });

  it('인자 없이 호출하면 현재 시각 기준', () => {
    const r = resolvePreviousPeriod();
    // 형식 검증만 (값은 시간 의존)
    expect(r.period).toMatch(/^\d{4}-\d{2}$/);
    expect(r.periodStart).toMatch(/^\d{4}-\d{2}-01$/);
    expect(r.periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
