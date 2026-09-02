import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production evidence V4 collector contract', () => {
  const source = readFileSync('scripts/collect-blog-production-evidence-v4.ts', 'utf8');

  it('is permanently read-only and collects immutable source and semantic capabilities', () => {
    expect(source).toContain('production evidence collection is permanently read-only');
    expect(source).toContain("event_payload ->> '__synthetic' = 'true'");
    expect(source).not.toContain("event_payload @> '{\"__synthetic\":true}'::jsonb");
    expect(source).toContain("checkSurface(`${base}/blog/__blog_v4_missing_probe__`, () => null, 404)");
    expect(source).toContain("'blog-ai-model-canary'");
    expect(source).toContain('v4_cron_route_contract_missing:');
    expect(source).toContain('production evidence collector accepts SELECT statements only');
    expect(source).toContain('supabase@2.116.0 db query --linked --output-format json --agent yes');
    expect(source).toContain("'supabase@2.116.0'");
    expect(source).toContain("'--output-format'");
    expect(source).toContain("'--agent'");
    expect(source).toContain("'yes'");
    expect(source).toContain('VERCEL_AUTOMATION_BYPASS_SECRET');
    expect(source).toContain("'x-vercel-protection-bypass'");
    expect(source).toContain("redirect: 'manual'");
    expect(source).toContain("payload.message === 'Unauthorized'");
    expect(source).toContain('readInngestRuntimeEvidence');
    expect(source).toContain('blog_data_readiness_evidence_required');
    expect(source).not.toContain("['supabase', 'db', 'query', '--linked', '--output', 'json'");
    expect(source).toContain("'legacy_public_slug_rpc_absent'");
    expect(source).toContain("'generation_selected_attempt'");
    expect(source).toContain("'ai_budget_ledger'");
  });

  it('collects snapshot parity, demand, measurement, surface, and rollout evidence', () => {
    expect(source).toContain("'missing_snapshot_slugs'");
    expect(source).toContain("'due_queued_without_verified_demand'");
    expect(source).toContain("'analytics_canary_passed_at'");
    expect(source).toContain('database-errors-since-candidate');
    expect(source).toContain('blog_publication_rollout_state');
    expect(source).toContain("argument('data-readiness')");
  });
});
