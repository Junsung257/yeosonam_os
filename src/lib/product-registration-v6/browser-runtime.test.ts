import { describe, expect, it } from 'vitest';

import { browserProofRuntimeCapability } from './browser-runtime';

describe('browser proof runtime capability', () => {
  it('recognizes bundled serverless Chromium on Vercel Linux', () => {
    expect(browserProofRuntimeCapability({
      platform: 'linux',
      executableCandidates: [],
      pathExists: () => false,
    })).toEqual({
      available: true,
      mode: 'serverless-chromium',
      reason: 'BUNDLED_SERVERLESS_CHROMIUM',
    });
  });

  it('prefers an explicitly configured remote browser', () => {
    expect(browserProofRuntimeCapability({
      platform: 'linux',
      browserWSEndpoint: 'wss://browser.example.test',
      executableCandidates: [],
      pathExists: () => false,
    }).mode).toBe('remote-cdp');
  });
});
