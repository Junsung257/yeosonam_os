import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260820100000_blog_publication_rollout_manual_transition_v1.sql',
  'utf8',
).toLowerCase();

describe('manual publication rollout transition migration', () => {
  it('records immutable approval and release provenance with service-role-only access', () => {
    expect(migration).toContain('create table if not exists public.blog_publication_rollout_manual_transitions');
    expect(migration).toContain('approval_reference');
    expect(migration).toContain('github_run_id');
    expect(migration).toContain('release_commit');
    expect(migration).toContain('evidence_sha256');
    expect(migration).toContain('alter table public.blog_publication_rollout_manual_transitions enable row level security');
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('to service_role');
  });

  it('only permits adjacent CAS promotions and blocks weak max_30 approvals', () => {
    expect(migration).toContain('invalid_manual_blog_publication_rollout_transition');
    expect(migration).toContain('manual_rollout_approval_reference_invalid');
    expect(migration).toContain('manual_rollout_approved_inventory_below_60');
    expect(migration).toContain('manual_rollout_state_version_conflict');
    expect(migration).toContain("p_expected_stage = 'pilot_3' and p_next_stage = 'ramp_10'");
    expect(migration).toContain("p_expected_stage = 'ramp_10' and p_next_stage = 'max_30'");
    expect(migration).toContain('for update');
  });
});
