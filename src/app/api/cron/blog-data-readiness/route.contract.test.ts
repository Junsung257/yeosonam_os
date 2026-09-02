import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('blog data readiness route contract', () => {
  it('fails closed on schema, production provenance, or Inngest runtime drift', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/cron/blog-data-readiness/route.ts'),
      'utf8',
    );

    expect(source).toContain('probeBlogRuntimeSchemaWithSupabaseV3');
    expect(source).toContain('!schemaReadiness.fullyReady');
    expect(source).toContain('!policy.deploymentProvenance.passed');
    expect(source).toContain('isInngestBlogAutopilotConfigured');
    expect(source).toContain("automation.mode !== 'cloud'");
    expect(source).toContain('automation.functionCount < automation.minimumFunctionCount');
    expect(source).toContain('status: critical ? 503 : 200');
  });
});
