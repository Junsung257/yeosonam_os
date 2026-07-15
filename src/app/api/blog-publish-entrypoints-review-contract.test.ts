import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('informational review policy across publish-capable entrypoints', () => {
  it.each([
    'src/app/api/blog/route.ts',
    'src/app/api/content-hub/publish/route.ts',
    'src/app/api/content-queue/route.ts',
  ])('blocks review bypass in %s', (path) => {
    const route = source(path);
    expect(route).toContain('getInformationalReviewBlockReason');
    expect(route).toContain('Human review approval is required before publishing this informational draft');
    expect(route).toContain('review_reason');
  });

  it('prevents the zero-click cron from silently replacing high-risk public information', () => {
    const route = source('src/app/api/cron/blog-regenerate-zero-click/route.ts');
    expect(route).toContain('isHighRiskInformationalTopic');
    expect(route).toContain("status: 'high_risk_review'");
    expect(route).toContain('must not be regenerated without a new human review');
  });
});
