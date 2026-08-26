import { describe, expect, it } from 'vitest';
import { scopeBlogContentOperationIdempotencyKeyV4 } from './materializer';

describe('blog content factory materializer idempotency scope', () => {
  it('scopes explicit staging canaries to their queue', () => {
    expect(scopeBlogContentOperationIdempotencyKeyV4({
      baseKey: 'blog-op-v4:stable',
      candidateId: 'queue-1',
      metadata: { blog_v4_staging_seed: 'canary-1' },
      environment: 'staging',
    })).toBe('blog-op-v4:stable:staging-canary:queue-1');
  });

  it('keeps production and non-canary idempotency unchanged', () => {
    const input = {
      baseKey: 'blog-op-v4:stable',
      candidateId: 'queue-1',
      metadata: { blog_v4_staging_seed: 'canary-1' },
    };
    expect(scopeBlogContentOperationIdempotencyKeyV4({ ...input, environment: 'production' })).toBe(input.baseKey);
    expect(scopeBlogContentOperationIdempotencyKeyV4({
      baseKey: input.baseKey,
      candidateId: input.candidateId,
      metadata: {},
      environment: 'staging',
    })).toBe(input.baseKey);
  });
});
