import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('pre-contract public blog restore migration', () => {
  const sql = readFileSync(join(
    process.cwd(),
    'supabase/migrations/20260725033000_restore_precontract_public_blog_rows.sql',
  ), 'utf8');

  it('restores only quality-passed publications from before the V2 cutoff', () => {
    expect(sql).toContain("c.published_at < timestamptz '2026-07-15 00:00:00+09'");
    expect(sql).toContain("c.quality_gate ->> 'passed'");
    expect(sql).toContain("'pending_review', 'in_review', 'rejected', 'changes_requested'");
    expect(sql).toContain("'information_legacy'");
  });

  it('keeps explicit suppression and current V2 evidence gates', () => {
    expect(sql).toContain("c.generation_meta ->> 'noindex'");
    expect(sql).toContain("c.generation_meta ->> 'redirect_to'");
    expect(sql).toContain("c.generation_meta -> 'information_claim_validation' ->> 'passed'");
    expect(sql).toContain("r.status = 'active'");
  });

  it('keeps the view server-only', () => {
    expect(sql).toContain('with (security_invoker = true)');
    expect(sql).not.toContain('c.*,');
    expect(sql).toContain('revoke all on public.public_blog_content_creatives from public, anon, authenticated');
    expect(sql).toContain('grant select on public.public_blog_content_creatives to service_role');
  });
});
