import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('blog publication rollout manual recovery migration', () => {
  const migration = readFileSync(
    'supabase/migrations/20260830154002_blog_publication_rollout_manual_recovery_v1.sql',
    'utf8',
  );

  it('requires the incident to be off the public surface with successful deletion evidence', () => {
    expect(migration).toContain('from public.public_blog_content_creatives');
    expect(migration).toContain("type = 'URL_DELETED'");
    expect(migration).toContain("status = 'succeeded'");
    expect(migration).toContain('blog_publication_rollout_incident_still_public');
  });

  it('requires a new approved V5 canary with complete prompt trace and judge evidence', () => {
    expect(migration).toContain("prompt_trace_version = 'blog-prompt-trace-v1'");
    expect(migration).toContain("e.evaluator_version = 'blog-editorial-harness-v5.0.0'");
    expect(migration).toContain("and status = 'approved_for_slot'");
    expect(migration).toContain("c.status = 'draft'");
  });

  it('recovers only to pilot_3 and writes immutable service-role-only evidence', () => {
    expect(migration).toContain("set stage = 'pilot_3'");
    expect(migration).toContain("status = 'active'");
    expect(migration).toContain('blog_publication_rollout_recoveries');
    expect(migration).toContain('revoke all on table public.blog_publication_rollout_recoveries');
    expect(migration).toContain('state_version_after = state_version_before + 1');
  });
});
