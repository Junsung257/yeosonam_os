import { describe, expect, it } from 'vitest';

import { extractSourceTicketingDeadline, inferTicketingDeadlineYear } from './ticketing-deadline';

describe('ticketing deadline extraction', () => {
  it('extracts slash date ticketing conditions using price date year', () => {
    expect(extractSourceTicketingDeadline('漠PUS-FSZ **6/28일이내 발권조건', {
      priceDates: [{ date: '2026-07-03' }],
    })).toBe('2026-06-28');
  });

  it('extracts compact same-line until-ticketing text', () => {
    expect(extractSourceTicketingDeadline('7월 1,8,15,22 (수)출발 판매가 ₩899,000/인 (7/1까지발권)', {
      yearHint: 2026,
    })).toBe('2026-07-01');
  });

  it('prefers explicit source year when present', () => {
    expect(extractSourceTicketingDeadline('2027.01.05까지 항공권 발권조건', {
      yearHint: 2026,
    })).toBe('2027-01-05');
  });

  it('ignores invalid calendar dates', () => {
    expect(extractSourceTicketingDeadline('2026-02-30까지 발권조건', {
      yearHint: 2026,
    })).toBeNull();
  });

  it('infers year from the first available price date before current year fallback', () => {
    expect(inferTicketingDeadlineYear({
      priceDates: [{ date: '2027-03-01' }],
      today: '2026-06-29',
    })).toBe(2027);
  });
});
