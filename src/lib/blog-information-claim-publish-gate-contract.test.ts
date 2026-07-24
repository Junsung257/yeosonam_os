import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'src/lib/blog-information-claim-publish-gate.ts'),
  'utf8',
);

describe('blog information claim publish gate persistence scope', () => {
  it('uses only claims linked to the creative when revalidating a published revision', () => {
    expect(source).toContain('loadPersistedClaimRecords(input.contentKey, input.creativeId)');
    expect(source).toContain("claimsQuery = claimsQuery.eq('creative_id', creativeId)");
  });

  it('uses the caller-provided intent instead of guessing from incidental body words', () => {
    expect(source).toContain('intentType: input.intentType ?? null');
    expect(source).not.toContain('/입국|출입국|비자|여권|세관|면세');
  });
});
