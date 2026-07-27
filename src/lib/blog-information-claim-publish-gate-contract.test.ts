import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'src/lib/blog-information-claim-publish-gate.ts'),
  'utf8',
);

describe('blog information claim publish gate persistence scope', () => {
  it('loads both draft-scoped and research-scoped claims when revalidating a revision', () => {
    expect(source).toContain('loadPersistedClaimRecords(input.contentKey, input.creativeId)');
    expect(source).toContain('creative_id.eq.${creativeId},creative_id.is.null');
  });

  it('uses the caller-provided intent instead of guessing from incidental body words', () => {
    expect(source).toContain('intentType: input.intentType ?? null');
    expect(source).not.toContain('/입국|출입국|비자|여권|세관|면세');
  });
  it('chunks evidence lookups so large claim sets do not fail the publish gate URL', () => {
    expect(source).toContain('selectBlogInformationRowsInChunks');
    expect(source).toContain("'blog_information_evidence'");
    expect(source).toContain('chunkSize = 100');
    expect(source).not.toContain(".from('blog_information_evidence')\n        .select('id, evidence_key");
  });
});
