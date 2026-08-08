import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260808135026_affiliate_auth_sessions_v2.sql'),
  'utf8',
);

describe('affiliate auth migration contract', () => {
  it('keeps invitation and session storage server-only', () => {
    for (const table of ['affiliate_invitations', 'affiliate_sessions', 'notification_outbox']) {
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated`);
      expect(migration).toContain(`GRANT ALL ON TABLE public.${table} TO service_role`);
    }
  });

  it('makes approval atomic and session revocation immediate', () => {
    expect(migration).toContain('approve_affiliate_application_v2');
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('affiliates_revoke_sessions_security_change');
    expect(migration).toContain('token_version_rotated');
  });

  it('does not backfill or erase existing credentials automatically', () => {
    const beforeRollback = migration.split('-- Manual rollback')[0];
    expect(beforeRollback).not.toContain("UPDATE public.affiliates\nSET portal_pin = NULL");
    expect(migration).toContain('existing portal_pin values are NOT changed');
  });
});

