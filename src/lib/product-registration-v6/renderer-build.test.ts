import { afterEach, describe, expect, it } from 'vitest';

import { currentProductRegistrationRendererBuildId } from './renderer-build';

const originalCommit = process.env.VERCEL_GIT_COMMIT_SHA;
const originalBuild = process.env.NEXT_PUBLIC_BUILD_ID;

afterEach(() => {
  if (originalCommit === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = originalCommit;
  if (originalBuild === undefined) delete process.env.NEXT_PUBLIC_BUILD_ID;
  else process.env.NEXT_PUBLIC_BUILD_ID = originalBuild;
});

describe('currentProductRegistrationRendererBuildId', () => {
  it('uses a stable local identity when preview env values are blank', () => {
    process.env.VERCEL_GIT_COMMIT_SHA = '';
    process.env.NEXT_PUBLIC_BUILD_ID = '   ';
    expect(currentProductRegistrationRendererBuildId()).toBe('local-v6-renderer');
  });

  it('prefers the deployed commit identity', () => {
    process.env.VERCEL_GIT_COMMIT_SHA = ' abc123 ';
    process.env.NEXT_PUBLIC_BUILD_ID = 'build-2';
    expect(currentProductRegistrationRendererBuildId()).toBe('abc123');
  });
});
