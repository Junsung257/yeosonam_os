import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = [
  './google-oauth-start/route.ts',
  './google-callback/route.ts',
  './meta-oauth-start/route.ts',
  './meta-callback/route.ts',
  './naver-oauth-start/route.ts',
  './naver-callback/route.ts',
  './threads-oauth-start/route.ts',
  '../admin/social-configs/route.ts',
];

describe('OAuth route state boundary', () => {
  it.each(files)('%s has no predictable development signing fallback', (path) => {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');

    expect(source).not.toMatch(/OAUTH_STATE_SECRET['"]\)\s*\?\?\s*['"]dev['"]/);
    expect(source).not.toMatch(/stateSecret\s*\?\?\s*['"]dev['"]/);
  });
});
