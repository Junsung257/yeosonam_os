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
  it('renders customer detail only from the promoted public detail projection', () => {
    const source = pageSourceWithoutComments();
    const proofIndex = source.indexOf('const allowInternalProof = await isInternalRenderProofRequest()');
    const snapshotIndex = source.indexOf('pkg = await getPublishedPackageDetail', proofIndex);
    const notFoundIndex = source.indexOf('if (!pkg) notFound()', snapshotIndex);

    expect(proofIndex).toBeGreaterThanOrEqual(0);
    expect(snapshotIndex).toBeGreaterThanOrEqual(0);
    expect(snapshotIndex).toBeGreaterThan(proofIndex);
    expect(notFoundIndex).toBeGreaterThan(snapshotIndex);
    expect(source).not.toContain('isPublicPublicationState');
    expect(source).not.toContain("from('public_package_snapshots')");
  });

  it('does not fall back to raw sibling package titles for customer option cards', () => {
    const source = pageSourceWithoutComments();
    const siblingIndex = source.indexOf('const publicSiblings = await getPublishedPackageCards');
    const siblingMapIndex = source.indexOf('catalogSiblings = publicSiblings', siblingIndex);
    const siblingEndIndex = source.indexOf('JSON-LD Product', siblingMapIndex);
    const siblingBlock = source.slice(siblingMapIndex, siblingEndIndex);

    expect(siblingIndex).toBeGreaterThanOrEqual(0);
    expect(siblingMapIndex).toBeGreaterThan(siblingIndex);
    expect(siblingBlock).toContain('const publicTitle = getNonEmptyString(publicSibling.title)');
    expect(siblingBlock).toContain('if (!publicTitle) return []');
    expect(siblingBlock).not.toContain('?? title');
    expect(siblingBlock).not.toContain('?? display_title');
  });
});
