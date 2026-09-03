import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const client = fs.readFileSync(
  `${process.cwd()}/src/app/admin/product-registration/reviews/HumanReviewClient.tsx`,
  'utf8',
);
const readRoute = fs.readFileSync(
  `${process.cwd()}/src/app/api/admin/product-registration/reviews/[caseId]/route.ts`,
  'utf8',
);
const adjudicateRoute = fs.readFileSync(
  `${process.cwd()}/src/app/api/admin/product-registration/reviews/[caseId]/adjudicate/route.ts`,
  'utf8',
);
const migration = fs.readFileSync(
  `${process.cwd()}/supabase/migrations/20260904093000_product_registration_human_review_case_read_v1.sql`,
  'utf8',
);

describe('product registration V6 human review UI contract', () => {
  it('keeps the three-pane UI on the authenticated review APIs', () => {
    expect(client).toContain("'/api/admin/product-registration/reviews/queue?limit=30'");
    expect(client).toContain("/api/admin/product-registration/reviews/${caseId}");
    expect(client).toContain("/session");
    expect(client).toContain("/receipt");
    expect(client).toContain("/adjudicate");
    expect(client).toContain('sourceTables');
    expect(client).toContain('sourceText');
    expect(client).toContain('candidateAxisKeys');
    expect(client).not.toContain('dangerouslySetInnerHTML');
    expect(client).not.toContain('supabase.from(');
  });

  it('requires a real reviewer route and forces adjudication slot server-side', () => {
    expect(readRoute).toContain('resolveAdminActorId');
    expect(readRoute).toContain('get_product_registration_review_case');
    expect(adjudicateRoute).toContain("submitReviewReceipt(request, context, 'adjudicator')");
  });

  it('returns only private lineage-bound source IR through service-role RPC', () => {
    expect(migration).toContain('get_product_registration_review_case');
    expect(migration).toContain('PRODUCT_REVIEW_CASE_SOURCE_LINEAGE_MISMATCH');
    expect(migration).toContain('PRODUCT_REVIEW_CASE_EXTRACTION_LINEAGE_MISMATCH');
    expect(migration).toContain('grant execute on function public.get_product_registration_review_case(uuid, uuid) to service_role');
    expect(migration).toContain("revoke all on function public.get_product_registration_review_case(uuid, uuid) from public, anon, authenticated");
    expect(migration).not.toContain('storage_path');
    expect(migration).not.toContain('signedUrl');
  });
});
