import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('product registration revision source-hash migration', () => {
  it('validates compatibility lineage through the tenant-scoped source document', () => {
    const sql = readFileSync(join(
      process.cwd(),
      'supabase/migrations/20260812124000_product_registration_revision_source_hash_contract.sql',
    ), 'utf8');

    expect(sql).toContain("pg_get_functiondef(");
    expect(sql).toContain('from public.product_source_documents source_document');
    expect(sql).toContain('source_document.id = r.source_document_id');
    expect(sql).toContain('source_document.tenant_id = r.tenant_id');
    expect(sql).toContain("source_document.sha256 = p_payload->>''source_hash''");
    expect(sql).toContain('REGISTRATION_COMPATIBILITY_SOURCE_HASH_CONTRACT_UNKNOWN');
    expect(sql).toContain('from public, anon, authenticated');
    expect(sql).toContain('to service_role');
  });
});
