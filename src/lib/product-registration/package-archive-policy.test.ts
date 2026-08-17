import { describe, expect, it } from 'vitest';

import { automaticArchiveReason } from './package-archive-policy';

describe('automaticArchiveReason', () => {
  it('does not archive an old row that still has a future departure', () => {
    expect(automaticArchiveReason({ price_dates: [{ date: '2026-09-20' }] }, '2026-08-15')).toBeNull();
  });

  it('archives only when every source-backed departure is past', () => {
    expect(automaticArchiveReason({
      price_dates: [{ date: '2026-07-01' }, { date: '2026-08-14' }],
    }, '2026-08-15')).toBe('all_departures_past');
  });

  it('keeps a mixed past and future tier active', () => {
    expect(automaticArchiveReason({
      price_tiers: [{ departure_dates: ['2026-07-01', '2026-10-01'] }],
    }, '2026-08-15')).toBeNull();
  });

  it('uses a dated range end and ignores malformed values', () => {
    expect(automaticArchiveReason({
      price_tiers: [{ departure_dates: ['not-a-date'], date_range: { end: '2026-08-01' } }],
    }, '2026-08-15')).toBe('all_departures_past');
  });

  it('does not guess when no trustworthy departure date exists', () => {
    expect(automaticArchiveReason({ price_dates: [], price_tiers: [] }, '2026-08-15')).toBeNull();
  });
});
