import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('blog data readiness route contract', () => {
  it('fails closed on schema or production provenance drift', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/cron/blog-data-readiness/route.ts'),
      'utf8',
    );

    expect(source).toContain('probeBlogRuntimeSchemaWithSupabaseV3');
    expect(source).toContain('!schemaReadiness.fullyReady');
    expect(source).toContain('!policy.deploymentProvenance.passed');
    expect(source).toContain(".eq('status', 'approved_for_slot')");
    expect(source).toContain('approvedForSlotCount');
    expect(source).toContain('publicationReady');
    expect(source).toContain('readyForDraftOnlyGeneration');
    expect(source).toContain('readyForLivePublication');
    expect(source).not.toContain('|| Number(approvedForSlot.count || 0) === 0;');
    expect(source).toContain('status: critical ? 503 : 200');
  });
});
