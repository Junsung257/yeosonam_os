import { describe, expect, it } from 'vitest';

import {
  extractSourceTicketingCondition,
  extractSourceTicketingDeadline,
  inferTicketingDeadlineYear,
} from './ticketing-deadline';

describe('ticketing deadline extraction', () => {
  it('extracts slash date ticketing conditions using the departure year', () => {
    expect(extractSourceTicketingDeadline('PUS-FSZ **6/28일 이내 발권조건', {
      priceDates: [{ date: '2026-07-03' }],
      today: '2026-06-20',
    })).toBe('2026-06-28');
  });

  it('extracts a compact same-line ticketing condition', () => {
    expect(extractSourceTicketingDeadline('7월 1,8,15,22 출발 판매가 599,000원 (7/1까지 발권)', {
      yearHint: 2026,
      today: '2026-06-20',
    })).toBe('2026-07-01');
  });

  it('selects the date nearest to 발권 rather than the departure date', () => {
    expect(extractSourceTicketingDeadline('8/28 출발 899,000원 · 8/14까지 발권조건', {
      priceDates: [{ date: '2026-08-28' }],
      today: '2026-08-01',
    })).toBe('2026-08-14');
  });

  it('prefers an explicit source year when present', () => {
    expect(extractSourceTicketingDeadline('2027.01.05까지 항공권 발권조건', {
      yearHint: 2026,
      today: '2026-08-15',
    })).toBe('2027-01-05');
  });

  it('uses the previous year for a December deadline tied to a January departure', () => {
    expect(extractSourceTicketingDeadline('12/20까지 발권조건', {
      priceDates: [{ date: '2027-01-10' }],
      today: '2026-12-01',
    })).toBe('2026-12-20');
  });

  it('does not roll an already-past deadline into the next year', () => {
    const condition = extractSourceTicketingCondition('8/14까지 발권조건', {
      priceDates: [{ date: '2026-08-28' }],
      today: '2026-08-15',
    });
    expect(condition).toMatchObject({
      deadline: '2026-08-14',
      status: 'expired',
      consultationOnly: true,
      marketingEligible: false,
      customerNotice: '발권기한 경과 · 현재 좌석과 요금 상담 확인',
    });
    expect(condition?.evidence.quote).toBe('8/14까지 발권조건');
    expect(condition?.conditionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps a relative source condition without inventing a fixed deadline', () => {
    expect(extractSourceTicketingCondition('출발 3일 전까지 발권 조건', {
      today: '2026-08-15',
    })).toMatchObject({
      kind: 'relative_condition',
      status: 'conditional',
      deadline: null,
      relativeDays: 3,
      customerNotice: '3일 이내 발권 조건',
    });
  });

  it('degrades multiple fixed deadlines instead of silently selecting one', () => {
    expect(extractSourceTicketingCondition([
      '8/28 출발은 8/14까지 발권조건',
      '9/6 출발은 8/20까지 발권조건',
    ].join('\n'), {
      yearHint: 2026,
      today: '2026-08-01',
    })).toMatchObject({
      kind: 'multiple_deadlines',
      status: 'conflicting',
      deadline: null,
      consultationOnly: true,
      marketingEligible: false,
    });
  });

  it('ignores invalid calendar dates', () => {
    expect(extractSourceTicketingDeadline('2026-02-30까지 발권조건', {
      yearHint: 2026,
      today: '2026-01-01',
    })).toBeNull();
  });

  it('infers the year from the first available departure date', () => {
    expect(inferTicketingDeadlineYear({
      priceDates: [{ date: '2027-03-01' }],
      today: '2026-06-29',
      month: 2,
      day: 20,
    })).toBe(2027);
  });

  it('ignores retained past departure rows when an active departure proves the deadline year', () => {
    expect(inferTicketingDeadlineYear({
      priceDates: [{ date: '2026-07-08' }, { date: '2026-08-19' }],
      today: '2026-08-16',
      month: 7,
      day: 30,
    })).toBe(2026);
  });
});
