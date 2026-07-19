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
  it('checks the source package publication state before rendering a public snapshot', () => {
    const source = pageSourceWithoutComments();
    const snapshotIndex = source.indexOf('const publicSnapshot = allowInternalProof');
    const pkgIndex = source.indexOf('const pkg = allowInternalProof ? rawPkg : publicSnapshot?.package', snapshotIndex);
    const stateIndex = source.indexOf('const publicationState = (rawPkg as', pkgIndex);
    const nonPublicBlockIndex = source.indexOf('!isPublicPublicationState(publicationState)', stateIndex);
    const renderStartIndex = source.indexOf('let matchQuery = sb.from', nonPublicBlockIndex);

    expect(snapshotIndex).toBeGreaterThanOrEqual(0);
    expect(pkgIndex).toBeGreaterThan(snapshotIndex);
    expect(stateIndex).toBeGreaterThan(pkgIndex);
    expect(nonPublicBlockIndex).toBeGreaterThan(stateIndex);
    expect(renderStartIndex).toBeGreaterThan(nonPublicBlockIndex);
    expect(source.slice(nonPublicBlockIndex, renderStartIndex)).toContain('notFound()');
    expect(source.slice(stateIndex, renderStartIndex)).toContain('!publicSnapshot');
    expect(source.slice(stateIndex, renderStartIndex)).not.toContain('publicationState &&');
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
