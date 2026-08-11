import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('product registration compatibility review-status migration', () => {
  it('uses an allowed private products lifecycle value and preserves RPC permissions', () => {
    const sql = readFileSync(join(
      process.cwd(),
      'supabase/migrations/20260812130000_product_registration_compatibility_review_status.sql',
    ), 'utf8');

    expect(sql).toContain("v_legacy_status constant text := '''pending_review'''");
    expect(sql).toContain("v_current_status constant text := '''REVIEW_NEEDED'''");
    expect(sql).toContain('v_occurrences <> 1');
    expect(sql).toContain('REGISTRATION_COMPATIBILITY_REVIEW_STATUS_CONTRACT_UNKNOWN');
    expect(sql).toContain('from public, anon, authenticated');
    expect(sql).toContain('to service_role');
  });
});
