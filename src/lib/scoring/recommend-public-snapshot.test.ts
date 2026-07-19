import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('recommendBestPackages public snapshot gate', () => {
  it('requires public publication state and current public snapshots before returning customer recommendations', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/scoring/recommend.ts'), 'utf8');

    expect(source).toContain('isPublicPublicationState');
    expect(source).toContain('fetchAndMergeCurrentPublicPackageCardSnapshots');
    expect(source).toContain('publication_state, package_revision');
    expect(source).toContain('.filter((row) => isPublicPublicationState(row.publication_state ?? null))');
    expect(source).toContain('const candidates = (await fetchAndMergeCurrentPublicPackageCardSnapshots');
    expect(source).toContain('title: (c as unknown as { title: string }).title');
  });
});
