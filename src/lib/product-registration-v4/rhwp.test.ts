import { describe, expect, it } from 'vitest';

import { getRhwpBinaryCandidates } from './rhwp';

describe('rhwp runtime binary discovery', () => {
  it('checks the Vercel Lambda task root independently from process.cwd()', () => {
    const candidates = getRhwpBinaryCandidates({
      cwd: '/var/task/.next/server/app/.well-known/workflow/v1/step',
      lambdaTaskRoot: '/var/task',
      vercelProjectDir: undefined,
      pwd: undefined,
      argvEntry: '/var/runtime/index.mjs',
      platform: 'linux',
    });

    const normalized = candidates.map(candidate => candidate.replaceAll('\\', '/'));
    expect(normalized.some(candidate => candidate.endsWith('/var/task/vendor/rhwp/0.8.2/rhwp'))).toBe(true);
    expect(normalized.some(candidate => candidate.endsWith('/var/task/.next/server/vendor/rhwp/0.8.2/rhwp'))).toBe(true);
  });

  it('uses the Windows executable name for local builds', () => {
    const candidates = getRhwpBinaryCandidates({
      cwd: 'C:\\dev\\yeosonam-os',
      platform: 'win32',
    });

    expect(candidates.some(candidate => candidate.endsWith('vendor\\rhwp\\0.8.2\\rhwp.exe'))).toBe(true);
  });
});
