import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('product registration compatibility UUID identity migration', () => {
  it('replaces unsupported min(uuid) and preserves RPC permissions', () => {
    const sql = readFileSync(join(
      process.cwd(),
      'supabase/migrations/20260812131000_product_registration_compatibility_uuid_identity.sql',
    ), 'utf8');

    expect(sql).toContain('min(id) into v_count, v_package_id');
    expect(sql).toContain('min(id::text)::uuid into v_count, v_package_id');
    expect(sql).toContain('REGISTRATION_COMPATIBILITY_UUID_IDENTITY_CONTRACT_UNKNOWN');
    expect(sql).toContain('from public, anon, authenticated');
    expect(sql).toContain('to service_role');
  });
});
