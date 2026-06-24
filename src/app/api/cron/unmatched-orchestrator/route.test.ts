import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const routePath = join(process.cwd(), 'src/app/api/cron/unmatched-orchestrator/route.ts');

describe('unmatched orchestrator route', () => {
  it('runs cron steps in-process instead of self-calling HTTP cron endpoints', () => {
    const source = readFileSync(routePath, 'utf8');

    expect(source).toContain('unmatchedClassifyGet');
    expect(source).toContain('resweepUnmatchedGet');
    expect(source).toContain('unmatchedAutoResolveGet');
    expect(source).not.toContain('fetch(url');
    expect(source).not.toContain("headers: authorization ? { authorization } : undefined");
  });
});
