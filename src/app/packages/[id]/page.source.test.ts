import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function pageSourceWithoutComments() {
  const source = readFileSync(join(process.cwd(), 'src/app/packages/[id]/page.tsx'), 'utf8');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('package customer detail page publication contract', () => {
  it('uses the exact snapshot before any customer render and never reads mutable facts for a V6 proof', () => {
    const source = pageSourceWithoutComments();
    const pointerIndex = source.indexOf('const routeResolution = !allowInternalProof');
    const rawResultIndex = source.indexOf('const rawPkgResult', pointerIndex);
    const snapshotIndex = source.indexOf('const publicSnapshot = v6ProofSnapshot ?? pointerSnapshot', rawResultIndex);
    const notFoundIndex = source.indexOf('if (!rawPkg) {', rawResultIndex);
    const pkgIndex = source.indexOf('const pkg = publicSnapshot?.package', snapshotIndex);
    const renderStartIndex = source.indexOf('let matchQuery = sb.from', notFoundIndex);

    expect(pointerIndex).toBeGreaterThanOrEqual(0);
    expect(rawResultIndex).toBeGreaterThan(pointerIndex);
    expect(snapshotIndex).toBeGreaterThan(rawResultIndex);
    expect(notFoundIndex).toBeGreaterThan(rawResultIndex);
    expect(pkgIndex).toBeGreaterThan(snapshotIndex);
    expect(renderStartIndex).toBeGreaterThan(notFoundIndex);
    expect(source).not.toContain("sb.from('travel_packages')");
    expect(source).not.toContain('isInternalRenderProofRequest');
    expect(source).toContain('verifyProductRegistrationV6ProofToken');
  });

  it('does not fall back to raw sibling package titles for customer option cards', () => {
    const source = pageSourceWithoutComments();
    const siblingIndex = source.indexOf('const siblingSnapshotByPackage');
    const siblingMapIndex = source.indexOf('catalogSiblings = siblingRows', siblingIndex);
    const siblingEndIndex = source.indexOf('JSON-LD Product', siblingMapIndex);
    const siblingBlock = source.slice(siblingMapIndex, siblingEndIndex);

    expect(siblingIndex).toBeGreaterThanOrEqual(0);
    expect(siblingMapIndex).toBeGreaterThan(siblingIndex);
    expect(siblingBlock).toContain('const publicTitle = getNonEmptyString(cardProjection?.title)');
    expect(siblingBlock).toContain('if (!publicTitle) return []');
    expect(siblingBlock).not.toContain('?? title');
    expect(siblingBlock).not.toContain('?? display_title');
  });

  it('keeps V6 proof visits out of customer popularity and behavior signals', () => {
    const pageSource = pageSourceWithoutComments();
    const clientSource = readFileSync(join(process.cwd(), 'src/app/packages/[id]/DetailClient.tsx'), 'utf8');
    const webVitalsSource = readFileSync(join(process.cwd(), 'src/components/WebVitalsReporter.tsx'), 'utf8');

    expect(pageSource).toContain('if (!allowInternalProof && pkg?.destination && !skipNonCriticalDbReads)');
    expect(pageSource).toContain('!v6ProofSnapshot && <UnmatchedActivitiesBeacon');
    expect(pageSource).toContain('!v6ProofSnapshot && <div className="pb-64 md:pb-12">');
    expect(clientSource).toContain("const proofMode = searchParams.has('__proof_snapshot')");
    expect(clientSource).toContain('if (!proofMode) {');
    expect(clientSource).toContain('if (proofMode && initialPackage)');
    expect(clientSource).toContain('!proofMode && <ReviewDigestStrip');
    expect(webVitalsSource).toContain("has('__proof_snapshot')");
  });
});
