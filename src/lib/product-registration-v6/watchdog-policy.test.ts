import { describe, expect, it } from 'vitest';

import { productRegistrationWatchdogAction } from './watchdog-policy';

const now = Date.parse('2026-08-12T12:00:00.000Z');

describe('product registration watchdog policy', () => {
  it('restarts a job that stopped heartbeating for 30 minutes but is younger than two hours', () => {
    expect(productRegistrationWatchdogAction({
      createdAt: '2026-08-12T11:00:00.000Z',
      lastHeartbeatAt: '2026-08-12T11:20:00.000Z',
      now,
    })).toBe('restart');
  });

  it('also detects a missing heartbeat and quarantines jobs older than two hours', () => {
    expect(productRegistrationWatchdogAction({
      createdAt: '2026-08-12T09:00:00.000Z',
      lastHeartbeatAt: null,
      now,
    })).toBe('quarantine');
  });

  it('leaves recently active jobs alone', () => {
    expect(productRegistrationWatchdogAction({
      createdAt: '2026-08-12T11:40:00.000Z',
      lastHeartbeatAt: '2026-08-12T11:50:00.000Z',
      now,
    })).toBe('ignore');
  });
});
