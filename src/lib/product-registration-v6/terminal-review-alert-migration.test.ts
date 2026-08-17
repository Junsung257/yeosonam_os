import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  `${process.cwd()}/supabase/migrations/20260817033000_product_registration_terminal_review_alerts.sql`,
  'utf8',
);

describe('product registration terminal review alerts migration', () => {
  it('creates one pending alert per terminal job without exposing the source', () => {
    expect(migration).toContain('idx_upload_review_queue_pending_registration_job');
    expect(migration).toContain("'discarded_source_incomplete', 'blocked_action_required'");
    expect(migration).toContain("'customerVisible', false");
    expect(migration).toContain('on conflict (upload_job_id)');
    expect(migration).toContain('PRODUCT_REGISTRATION_REVIEW_ALERT_SOURCE_TENANT_MISMATCH');
  });

  it('is service-role only with a pinned search path', () => {
    expect(migration).toContain('set search_path = pg_catalog, public, pg_temp');
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('to service_role');
  });
});
