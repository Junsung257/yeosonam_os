import { afterEach, describe, expect, it, vi } from 'vitest';
import { runOptionalSupabaseQuery, runSupabaseQueryWithTimeout } from './supabase-query-guard';

describe('supabase-query-guard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects when a query ignores the abort signal and never settles', async () => {
    vi.useFakeTimers();
    const neverSettles = new Promise<unknown>(() => {});

    const result = runSupabaseQueryWithTimeout(neverSettles, {
      label: 'unit.never-settles',
      timeoutMs: 500,
    });
    const expectation = expect(result).rejects.toThrow('TIMEOUT: unit.never-settles exceeded 500ms');

    await vi.advanceTimersByTimeAsync(500);
    await expectation;
  });

  it('returns the fallback when an optional query times out', async () => {
    vi.useFakeTimers();
    const neverSettles = new Promise<unknown>(() => {});

    const result = runOptionalSupabaseQuery(neverSettles, { data: [] }, {
      label: 'unit.optional-never-settles',
      timeoutMs: 500,
    });
    const expectation = expect(result).resolves.toEqual({ data: [] });

    await vi.advanceTimersByTimeAsync(500);
    await expectation;
  });
});
