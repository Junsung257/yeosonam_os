import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(
  process.cwd(),
  'src/app/api/admin/product-registration/v61/release-authorizations/route.ts',
), 'utf8');

describe('retired direct V6.1 publication route', () => {
  it('requires the publication request workflow without mutating DB state', () => {
    expect(source).toContain('PUBLICATION_REQUEST_WORKFLOW_REQUIRED');
    expect(source).toContain('status: 410');
    expect(source).not.toContain('issue_product_registration_release_authorization');
    expect(source).not.toContain('publish_product_registration_snapshot_atomic');
    expect(source).not.toContain('getSupabaseAdmin');
  });
});
