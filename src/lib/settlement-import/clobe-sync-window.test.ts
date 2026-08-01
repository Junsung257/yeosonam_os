import { describe, expect, it } from 'vitest';
import { splitClobeSyncWindow } from './clobe-sync-window';

describe('splitClobeSyncWindow', () => {
  it('keeps a single-month range together', () => {
    expect(splitClobeSyncWindow('2026-07-01', '2026-07-10')).toEqual([
      { from: '2026-07-01', to: '2026-07-10' },
    ]);
  });

  it('splits a long range into at most 14-day calendar-month chunks', () => {
    expect(splitClobeSyncWindow('2026-05-20', '2026-07-10')).toEqual([
      { from: '2026-05-20', to: '2026-05-31' },
      { from: '2026-06-01', to: '2026-06-14' },
      { from: '2026-06-15', to: '2026-06-28' },
      { from: '2026-06-29', to: '2026-06-30' },
      { from: '2026-07-01', to: '2026-07-10' },
    ]);
  });

  it('rejects reversed ranges', () => {
    expect(() => splitClobeSyncWindow('2026-08-01', '2026-07-31')).toThrow('must not be after');
  });
});
