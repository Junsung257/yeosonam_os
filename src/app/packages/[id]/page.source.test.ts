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
  it('uses the exact pointer snapshot before any customer render and limits raw reads to internal proof', () => {
    const source = pageSourceWithoutComments();
    const pointerIndex = source.indexOf('const pointerSnapshot = !allowInternalProof');
    const rawResultIndex = source.indexOf('let rawPkgResult', pointerIndex);
    const internalProofIndex = source.indexOf('if (allowInternalProof)', rawResultIndex);
    const rawQueryIndex = source.indexOf("sb.from('travel_packages')", internalProofIndex);
    const snapshotIndex = source.indexOf('const publicSnapshot = v6ProofSnapshot ?? pointerSnapshot', rawQueryIndex);
    const pkgIndex = source.indexOf('const pkg = (v6ProofSnapshot?.package ?? (allowInternalProof ? rawPkg : publicSnapshot?.package))', snapshotIndex);
    const notFoundIndex = source.indexOf('if (!pkg) {', pkgIndex);
    const renderStartIndex = source.indexOf('let matchQuery = sb.from', notFoundIndex);

    expect(pointerIndex).toBeGreaterThanOrEqual(0);
    expect(rawResultIndex).toBeGreaterThan(pointerIndex);
    expect(internalProofIndex).toBeGreaterThan(rawResultIndex);
    expect(rawQueryIndex).toBeGreaterThan(internalProofIndex);
    expect(snapshotIndex).toBeGreaterThan(rawQueryIndex);
    expect(pkgIndex).toBeGreaterThan(snapshotIndex);
    expect(notFoundIndex).toBeGreaterThan(pkgIndex);
    expect(renderStartIndex).toBeGreaterThan(notFoundIndex);
    expect(source.slice(rawResultIndex, internalProofIndex)).toContain('pointerSnapshot.package');
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
});
