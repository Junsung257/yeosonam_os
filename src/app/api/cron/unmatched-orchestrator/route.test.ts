import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const routePath = join(process.cwd(), 'src/app/api/cron/unmatched-orchestrator/route.ts');
const promoteInternalRoutePath = join(process.cwd(), 'src/app/api/cron/promote-internal-candidates/route.ts');

describe('unmatched orchestrator route', () => {
  it('runs cron steps in-process instead of self-calling HTTP cron endpoints', () => {
    const source = readFileSync(routePath, 'utf8');

    expect(source).toContain('unmatchedClassifyGet');
    expect(source).toContain('resweepUnmatchedGet');
    expect(source).toContain('unmatchedAutoResolveGet');
    expect(source).not.toContain('fetch(url');
    expect(source).not.toContain("headers: authorization ? { authorization } : undefined");
  });

  it('re-enriches affected packages after internal attraction candidate promotion', () => {
    const source = readFileSync(promoteInternalRoutePath, 'utf8');

    expect(source).toContain("from '@/lib/package-reenrich-on-attraction-change'");
    expect(source).toContain('affectedAttractionIds.add(attractionId)');
    expect(source).toContain('affectedPackageIds.add(sourceRow.package_id)');
    expect(source).toContain('reEnrichAffectedPackages([...affectedAttractionIds]');
    expect(source).toContain('forceRevalidate: true');
    expect(source).toContain('reenrich,');
  });
});
