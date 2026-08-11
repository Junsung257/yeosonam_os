import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('source upload append-only idempotency migration', () => {
  const sql = readFileSync(join(
    process.cwd(),
    'supabase/migrations/20260812025500_product_registration_source_upload_append_only_idempotency.sql',
  ), 'utf8');

  it('never updates either immutable source lineage table on conflict', () => {
    expect(sql).toContain('on conflict (tenant_id, sha256, byte_size) do nothing');
    expect(sql).toContain('on conflict (tenant_id, request_key) do nothing');
    expect(sql).not.toMatch(/on conflict[\s\S]{0,160}do update/i);
  });

  it('rejects request-key reuse for a different source document', () => {
    expect(sql).toContain('REGISTRATION_SOURCE_UPLOAD_REQUEST_KEY_CONFLICT');
    expect(sql).toContain('v_existing_source_document_id is distinct from v_source_document_id');
  });
});
