import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('recommendBestPackages public snapshot gate', () => {
  it('uses the promoted snapshot pointer as the only customer recommendation gate', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/scoring/recommend.ts'), 'utf8');

    expect(source).not.toContain('isPublicPublicationState');
    expect(source).toContain('getPublishedPackageCards');
    expect(source).toContain('publication_state, package_revision');
    expect(source).not.toContain(".in('publication_state'");
    expect(source).toContain('const candidates = (await getPublishedPackageCards');
    expect(source).toContain('title: (c as unknown as { title: string }).title');
  });
});
