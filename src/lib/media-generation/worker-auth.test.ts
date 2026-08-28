import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSecret: vi.fn() }));
vi.mock('@/lib/secret-registry', () => ({ getSecret: mocks.getSecret }));

import { isMediaCodexWorkerAuthorized } from './worker-auth';

describe('Codex media worker authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSecret.mockReturnValue('x'.repeat(48));
  });

  it('accepts only the dedicated bearer secret', () => {
    const accepted = new Request('https://example.test', {
      headers: { authorization: `Bearer ${'x'.repeat(48)}` },
    });
    const rejected = new Request('https://example.test', {
      headers: { authorization: `Bearer ${'y'.repeat(48)}` },
    });
    expect(isMediaCodexWorkerAuthorized(accepted)).toBe(true);
    expect(isMediaCodexWorkerAuthorized(rejected)).toBe(false);
    expect(mocks.getSecret).toHaveBeenCalledWith('MEDIA_CODEX_WORKER_TOKEN');
  });

  it('fails closed when the configured secret is missing or short', () => {
    mocks.getSecret.mockReturnValue('short');
    const request = new Request('https://example.test', {
      headers: { authorization: 'Bearer short' },
    });
    expect(isMediaCodexWorkerAuthorized(request)).toBe(false);
  });
});
