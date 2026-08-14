import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260814033000_blog_medication_high_risk_policy.sql',
), 'utf8');
const rollback = readFileSync(join(
  process.cwd(),
  'supabase/rollbacks/20260814_blog_medication_high_risk_policy_rollback.sql',
), 'utf8');

describe('blog medication high-risk policy migration', () => {
  it('keeps the SQL evaluator aligned with medication review policy', () => {
    for (const term of ['의약품', '상비약', '비상약', '처방약', '처방전', '약국', '복용', 'medication', 'prescription']) {
      expect(migration).toContain(term);
    }
    expect(migration).toContain("coalesce(p_review_status, 'none') <> 'approved'");
    expect(migration).toContain('grant execute on function public.evaluate_blog_public_eligibility_v3');
  });

  it('documents dry-run, rollback and no-backfill behavior', () => {
    expect(migration).toContain('Dry-run audit before apply');
    expect(migration).toContain('Rollback SQL');
    expect(migration).toContain('Schema/backfill: none');
    expect(rollback).toContain('No rows are mutated');
    expect(rollback).toContain('create or replace function public.evaluate_blog_public_eligibility_v3');
    expect(rollback).not.toContain('의약품');
  });
});
