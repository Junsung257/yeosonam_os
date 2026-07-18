import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('public blog eligibility view migration', () => {
  const sql = readFileSync(join(
    process.cwd(),
    'supabase/migrations/20260715223000_public_blog_content_eligibility_view.sql',
  ), 'utf8');

  it('uses security-invoker and service-role-only grants', () => {
    expect(sql).toContain('with (security_invoker = true)');
    expect(sql).toContain('revoke all on public.public_blog_content_creatives from public, anon, authenticated');
    expect(sql).toContain('grant select on public.public_blog_content_creatives to service_role');
    expect(sql).toContain("'failed', 'skipped'");
  });

  it('requires current review, quality, claim, and live representative truth for V2', () => {
    expect(sql).toContain("c.review_status, 'none'");
    expect(sql).toContain("c.quality_gate ->> 'passed'");
    expect(sql).toContain("c.generation_meta -> 'information_claim_validation' ->> 'passed'");
    expect(sql).toContain("r.status = 'active'");
    expect(sql).toContain('r.canonical_creative_id = c.id');
    expect(sql).toContain('r.canonical_slug = c.slug');
  });

  it('keeps product and legacy allowances explicit', () => {
    expect(sql).toContain('c.product_id is not null');
    expect(sql).toContain("timestamptz '2026-07-15 00:00:00+09'");
    expect(sql).toContain("'information_legacy'");
  });
});
