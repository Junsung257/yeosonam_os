import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260904113000_product_registration_human_review_resume_v1.sql'),
  'utf8',
);
const route = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/cron/product-registration-v6-review-resume/route.ts'),
  'utf8',
);
const derived = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/product-registration-v6/derived-extraction.ts'),
  'utf8',
);

describe('V6 human review resume boundary', () => {
  it('claims only terminal review events with a lease and a unique run', () => {
    expect(migration).toContain('product_review_resume_runs');
    expect(migration).toContain("unique (event_id)");
    expect(migration).toContain("c.status in ('accepted', 'source_insufficient', 'system_quarantined')");
    expect(migration).toContain('x.extraction_hash = c.parent_extraction_hash');
    expect(migration).toContain('for update of e skip locked');
    expect(migration).toContain("lease_expires_at = excluded.lease_expires_at");
    expect(migration).toContain("grant execute on function public.claim_product_registration_review_resume(integer, text) to service_role");
    expect(migration).not.toContain('grant select on table internal_product_registration.product_review_resume_runs');
  });

  it('keeps resume route disabled by default and behind the publication freeze', () => {
    expect(route).toContain('PRODUCT_REGISTRATION_V6_REVIEW_RESUME_ENABLED');
    expect(route).toContain('!config.publicationFrozen');
    expect(route).toContain('claim_product_registration_review_resume');
    expect(route).toContain('complete_product_registration_review_resume');
    expect(route).toContain("status: sideEffectAttempted ? 'unknown_outcome' : 'failed'");
    expect(route).toContain('persistDerivedDocumentExtraction');
    expect(route).toContain('persistDerivedCanonicalNormalization');
    expect(route).not.toContain('commitCanonicalRevisionAtomic');
    expect(route).not.toContain('createProductSnapshot');
    expect(route).not.toContain('publication_pointer');
  });

  it('records ownership-only revalidation as a shadow normalization', () => {
    expect(derived).toContain('normalizeHumanReviewDecision');
    expect(derived).toContain('persistHumanReviewNormalization');
    expect(derived).toContain(':human-review:');
    expect(derived).toContain('revisionWriteAuthority: false');
    expect(derived).toContain('publicationPointerWriteAuthority: false');
    expect(derived).toContain('HUMAN_REVIEW_NORMALIZATION_POLICY_VIOLATION');
  });
});
