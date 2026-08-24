import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('recommendBestPackages public snapshot gate', () => {
  it('bounds customer recommendations to exact public catalog ids', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/scoring/recommend.ts'), 'utf8');

    expect(source).toContain('listPublicCatalog');
    expect(source).toContain('const publicIds = publicCatalog.map');
    expect(source).toContain(".in('id', publicIds)");
    expect(source).not.toContain('isPublicPublicationState');
    expect(source).toContain('title: (c as unknown as { title: string }).title');
  });
});
