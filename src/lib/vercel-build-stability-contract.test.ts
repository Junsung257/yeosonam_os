import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Vercel build stability contract', () => {
  it('keeps the webpack build worker opt-in after production stalls', () => {
    const source = readFileSync(join(process.cwd(), 'next.config.js'), 'utf8');

    expect(source).toContain("process.env.NEXT_BUILD_WEBPACK_WORKER === '1'");
    expect(source).not.toContain("process.env.NEXT_BUILD_WEBPACK_WORKER !== '0'");
    expect(source).toContain('webpackBuildWorker: enableWebpackBuildWorker');
  });

  it('enables webpack peak-memory optimizations only for hosted builds', () => {
    const source = readFileSync(join(process.cwd(), 'next.config.js'), 'utf8');

    expect(source).toContain("webpackMemoryOptimizations: process.env.VERCEL === '1'");
  });
});
