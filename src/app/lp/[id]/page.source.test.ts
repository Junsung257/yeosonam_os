import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function pageSource() {
  return readFileSync(join(process.cwd(), 'src/app/lp/[id]/page.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('LP customer publication contract', () => {
  it('requires a public authority route state before loading customer facts', () => {
    const source = pageSource();
    const routeStateIndex = source.lastIndexOf('const routeState = await publicRouteState(id);');
    const loadIndex = source.lastIndexOf('const data = await safeLoadLpPackage(id, loadOptions);');
    const publicGuardIndex = source.indexOf("if (routeState.state !== 'PUBLIC') throw new Error('PACKAGE_VISIBILITY_STATE_INVALID');");

    expect(routeStateIndex).toBeGreaterThanOrEqual(0);
    expect(publicGuardIndex).toBeGreaterThan(routeStateIndex);
    expect(loadIndex).toBeGreaterThan(publicGuardIndex);
    expect(source).toContain("if (routeState.state === 'UNDER_REVIEW') return <ProductReviewNotice />;");
    expect(source).toContain("if (routeState.state === 'UNAVAILABLE') throw new Error('PACKAGE_VISIBILITY_LOOKUP_UNAVAILABLE');");
  });

  it('keeps signed proof metadata out of search indexes', () => {
    const source = pageSource();

    expect(source).toContain('const proofMode = Boolean(loadOptions.proofSnapshotId);');
    expect(source).toContain("? { robots: { index: false, follow: false, nocache: true } }");
  });
});
