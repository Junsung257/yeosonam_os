import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('blog quality backfill publish contract', () => {
  it('writes only posts that pass the same strict report as live publishing', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'scripts/backfill-blog-quality.ts'),
      'utf8',
    );

    expect(source).toContain('const publishReady = qaReport.passed;');
    expect(source).not.toContain('criticalCount === 0) return false');
  });

  it('preserves an existing strong SEO description during a corpus audit', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'scripts/backfill-blog-quality.ts'),
      'utf8',
    );

    expect(source).toContain('isSeoStrongDescription(current, row, primaryKeyword)');
    expect(source).toContain('return current;');
    expect(source).not.toContain('improveBackfillSeoDescriptionCustomer(_description');
  });
});
