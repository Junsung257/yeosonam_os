import { describe, expect, it } from 'vitest';

import { classifyBlogProviderFailure, isRetryableBlogProviderFailure } from './provider-failure';

describe('classifyBlogProviderFailure', () => {
  it('classifies DeepSeek balance errors as a non-retryable external blocker', () => {
    expect(classifyBlogProviderFailure('402 Insufficient Balance')).toBe('provider_insufficient_balance');
    expect(classifyBlogProviderFailure('insufficient credits')).toBe('provider_insufficient_balance');
  });

  it('keeps retryable provider conditions distinct from invalid requests', () => {
    const rateLimited = classifyBlogProviderFailure('429 Too Many Requests');
    const unavailable = classifyBlogProviderFailure('503 Service Unavailable');
    expect(rateLimited).toBe('provider_rate_limited');
    expect(isRetryableBlogProviderFailure(rateLimited)).toBe(true);
    expect(unavailable).toBe('provider_unavailable');
    expect(isRetryableBlogProviderFailure(unavailable)).toBe(true);
    expect(classifyBlogProviderFailure('401 invalid api key')).toBe('provider_invalid_request');
    expect(isRetryableBlogProviderFailure('provider_insufficient_balance')).toBe(false);
  });

  it('uses an explicit unknown code for unstructured provider errors', () => {
    expect(classifyBlogProviderFailure('provider returned an unexpected response')).toBe('provider_unknown_failure');
  });
});
