import { describe, expect, it, vi } from 'vitest';
import {
  evaluateThreadsDistribution,
  getThreadsFullText,
  getThreadsMainText,
  postingHourKst,
} from './threads-automation';
import { runCriticGate } from './critic';

vi.mock('./critic', async () => {
  const actual = await vi.importActual<typeof import('./critic')>('./critic');
  return {
    ...actual,
    runCriticGate: vi.fn(),
  };
});

describe('threads-automation', () => {
  it('extracts the main and full Threads text from payload variants', () => {
    const payload = {
      main: 'Main hook for a Jeju family trip',
      thread: ['Reply one', '', 'Reply two'],
      hashtags: ['#jeju', '#family'],
    };

    expect(getThreadsMainText(payload)).toBe('Main hook for a Jeju family trip');
    expect(getThreadsFullText(payload)).toBe('Main hook for a Jeju family trip\n\nReply one\n\nReply two\n\n#jeju #family');
  });

  it('computes posting hour in KST from a UTC date', () => {
    expect(postingHourKst(new Date('2026-06-03T15:30:00.000Z'))).toBe(0);
  });

  it('rejects invalid Threads body before the critic gate', async () => {
    const result = await evaluateThreadsDistribution({
      payload: { main: '' },
      scheduledFor: '2026-06-03T00:00:00.000Z',
    });

    expect(result.approved).toBe(false);
    expect(result.predicted_er).toBe(0);
    expect(vi.mocked(runCriticGate)).not.toHaveBeenCalled();
  });

  it('returns critic gate approval with predicted ER', async () => {
    vi.mocked(runCriticGate).mockResolvedValueOnce({
      approved: true,
      predicted_er: 0.072,
      reason: 'ok',
    } as Awaited<ReturnType<typeof runCriticGate>>);

    const result = await evaluateThreadsDistribution({
      payload: { main: 'This Jeju family trip saves time without feeling rushed' },
      scheduledFor: '2026-06-03T00:00:00.000Z',
    });

    expect(result.approved).toBe(true);
    expect(result.predicted_er).toBe(0.072);
  });
});
