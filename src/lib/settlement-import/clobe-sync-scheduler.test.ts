import { describe, expect, it } from 'vitest';
import { getScheduledClobeSyncWindow } from './clobe-sync-scheduler';

describe('getScheduledClobeSyncWindow', () => {
  it('backfills the oldest missing provider id in a bounded 14-day window', () => {
    expect(getScheduledClobeSyncWindow({
      oldestMissingReceivedAt: '2026-02-03T15:20:00.000Z',
      now: new Date('2026-08-02T12:00:00.000Z'),
    })).toEqual({
      mode: 'provider_id_backfill',
      from: '2026-02-04',
      to: '2026-02-17',
    });
  });

  it('syncs the latest 30 KST dates after provider ids are complete', () => {
    expect(getScheduledClobeSyncWindow({
      oldestMissingReceivedAt: null,
      now: new Date('2026-08-02T00:30:00.000Z'),
    })).toEqual({
      mode: 'recent',
      from: '2026-07-04',
      to: '2026-08-02',
    });
  });
});
