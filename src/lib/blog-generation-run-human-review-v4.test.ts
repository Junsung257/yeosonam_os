import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('blog generation run human review transition', () => {
  const source = readFileSync('src/lib/blog-generation-run-v4.ts', 'utf8');

  it('removes policy-blocked drafts from the publication slot inventory', () => {
    const start = source.indexOf('export async function markBlogGenerationRunForHumanReviewV4');
    const helper = source.slice(start);
    expect(start).toBeGreaterThan(0);
    expect(helper).toContain("status: 'human_review'");
    expect(helper).toContain("disposition: 'human_review'");
    expect(helper).toContain('scheduled_publish_at: null');
    expect(helper).toContain('content_creative_id: input.creativeId');
    expect(helper).toContain(".in('status', ['approved_for_slot', 'human_review'])");
  });
});
