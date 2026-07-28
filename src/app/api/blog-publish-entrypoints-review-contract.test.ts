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

  it.each([
    'src/app/api/blog/route.ts',
    'src/app/api/content-hub/publish/route.ts',
    'src/app/api/content-queue/route.ts',
  ])('runs the informational claim evidence gate in %s', (path) => {
    const route = source(path);
    expect(route).toContain('evaluateBlogInformationClaimPublishGate');
    expect(route).toContain('intentType:');
    expect(route).toContain('expectedScope:');
    expect(route).toContain('generation_meta:');
    expect(route).toContain('Informational claim evidence gate failed');
  });

  it('keeps claim failures private in the automatic publisher', () => {
    const route = source('src/app/api/cron/blog-publisher/route.ts');
    expect(route).toContain('evaluateBlogInformationClaimPublishGate({');
    expect(route).toContain('persistBlogInformationClaimFindings({');
    expect(route).toContain('intentType:');
    expect(route).toContain('expectedScope:');
    expect(route).toContain("reason: requiresClaimReview");
    expect(route).toContain("'informational_claim_review_required'");
  });

  it('prevents the zero-click cron from silently replacing high-risk public information', () => {
    const route = source('src/app/api/cron/blog-regenerate-zero-click/route.ts');
    const publisher = source('src/app/api/cron/blog-publisher/route.ts');
    expect(route).toContain('isHighRiskInformationalTopic');
    expect(route).toContain("status: 'high_risk_review'");
    expect(route).toContain('requires human review');
    expect(route).toContain('PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE');
    expect(route).toContain('atomic_publish_replace: true');
    expect(route).not.toContain('llmCall');
    expect(route).not.toContain(".from('content_creatives')\n          .update(");
    expect(publisher).toContain('evaluateBlogInformationClaimPublishGate({');
    expect(publisher).toContain('published_atomic_upgrade_claim_gate_failed');
    expect(publisher).toContain('preserved_published_creative_id');
  });

  it('preserves a verified published body for metadata-only republishing', () => {
    const route = source('src/app/api/blog/route.ts');
    expect(route).toContain("row?.status === 'published'");
    expect(route).toContain('blog_html === undefined');
    expect(route).toContain('preserveBody:');
  });
});
