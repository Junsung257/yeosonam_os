import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';
import { formatRatioPercent, formatScore100 } from '@/lib/admin/registration-monitor-format';

function pageSource(): string {
  return readFileSync(join(process.cwd(), 'src/app/admin/registration-monitor/page.tsx'), 'utf8');
}

describe('/admin/registration-monitor product learning engine panel', () => {
  it('shows review evidence needed to promote macro work items safely', () => {
    const source = pageSource();

    expect(source).toContain('Product Learning Engine');
    expect(source).toContain('<th>hash/package</th>');
    expect(source).toContain('<th>checks</th>');
    expect(source).toContain('score100(learningScore.combined)');
    expect(source).not.toContain('pct(learningScore.combined)');
    expect(source).toContain('const score100 = formatScore100');
    expect(source).toContain('item.evidenceRawTextHashes[0]');
    expect(source).toContain('item.evidencePackageIds[0]');
    expect(source).toContain('item.fixturePlan.assertions[0]');
    expect(source).toContain('item.verificationCommands[0]');
  });

  it('formats learning scores on a 100-point scale instead of percent inflation', () => {
    expect(formatScore100(65)).toBe('65 / 100');
    expect(formatRatioPercent(65)).toBe('65 / 100');
    expect(formatRatioPercent(0.651)).toBe('65.1%');
  });
});
