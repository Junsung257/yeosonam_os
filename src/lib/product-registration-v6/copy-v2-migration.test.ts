import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260824101000_product_registration_customer_copy_v2.sql',
), 'utf8');

describe('product registration customer copy V2 migration', () => {
  it('caches one immutable result per revision, locale, policy and deterministic facts', () => {
    expect(migration).toContain('idx_product_registration_copy_exact_facts_policy');
    expect(migration).toContain('deterministic_facts_hash');
    expect(migration).toContain('get_product_registration_v6_cached_copy');
    expect(migration).toContain("copy.validation_state = 'verified'");
  });

  it('requires the V2 copy policy and minimum quality before snapshot use', () => {
    expect(migration).toContain("copy.copy_policy_version = 'product-registration-customer-copy-v2'");
    expect(migration).toContain('copy.quality_score >= 72');
    expect(migration).toContain('copy.source_hash = source_document.sha256');
    expect(migration).toContain('source_document.id = revision.source_document_id');
    expect(migration).toContain('copy.revision_hash = revision.payload_hash');
  });

  it('keeps copy RPCs service-only', () => {
    expect(migration).toContain('revoke all on function public.persist_product_registration_v6_copy_revision(jsonb)');
    expect(migration).toContain('grant execute on function public.get_product_registration_v6_cached_copy(uuid, text, text, text)');
    expect(migration).toContain('to service_role');
  });
});
