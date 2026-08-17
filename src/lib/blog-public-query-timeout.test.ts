import { describe, expect, it, vi } from 'vitest';

import {
  BlogPublicQueryTimeoutError,
  runBlogPublicQueryWithTimeout,
} from './blog-public-query-timeout';

describe('blog public query hard timeout', () => {
  it('returns a settled query result and clears the deadline', async () => {
    await expect(runBlogPublicQueryWithTimeout('catalog', {
      abortSignal: async () => ({ data: ['ok'] }),
    }, 100)).resolves.toEqual({ data: ['ok'] });
  });

  it('rejects at the deadline even when the adapter ignores abort', async () => {
    vi.useFakeTimers();
    const observed = { signal: null as AbortSignal | null };
    const result = runBlogPublicQueryWithTimeout('facet', {
      abortSignal: (signal) => {
        observed.signal = signal;
        return new Promise<never>(() => undefined);
      },
    }, 25);

    const assertion = expect(result).rejects.toEqual(expect.objectContaining({
      name: 'BlogPublicQueryTimeoutError',
      label: 'facet',
      timeoutMs: 25,
    }));
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(observed.signal).not.toBeNull();
    expect((observed.signal as AbortSignal).aborted).toBe(true);
    vi.useRealTimers();
  });

  it('uses a safe finite timeout for invalid input', async () => {
    vi.useFakeTimers();
    const result = runBlogPublicQueryWithTimeout('snapshot', {
      abortSignal: () => new Promise<never>(() => undefined),
    }, Number.NaN);
    const assertion = expect(result).rejects.toBeInstanceOf(BlogPublicQueryTimeoutError);
    await vi.advanceTimersByTimeAsync(6000);
    await assertion;
    vi.useRealTimers();
  });
});
