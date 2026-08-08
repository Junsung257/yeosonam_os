import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildAffiliateApplicationIdempotencyKey,
  normalizeAffiliatePhone,
} from './application-contract';

describe('affiliate application contract', () => {
  it('normalizes phone numbers without retaining formatting characters', () => {
    expect(normalizeAffiliatePhone('010-1234-5678')).toBe('01012345678');
  });

  it('generates the same retry key for the same application boundary', () => {
    const input = {
      normalizedPhone: '01012345678',
      normalizedChannelUrl: 'https://example.com/channel',
    };
    expect(buildAffiliateApplicationIdempotencyKey(input))
      .toBe(buildAffiliateApplicationIdempotencyKey(input));
  });

  it('rejects malformed caller-supplied idempotency keys', () => {
    expect(() => buildAffiliateApplicationIdempotencyKey({
      requestedKey: 'short',
      normalizedPhone: '01012345678',
      normalizedChannelUrl: 'https://example.com/channel',
    })).toThrow('INVALID_IDEMPOTENCY_KEY');
  });

  it('keeps every application insert field in the current migration contract', () => {
    const route = readFileSync(
      join(process.cwd(), 'src/app/api/partner-apply/route.ts'),
      'utf8',
    );
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260808133613_affiliate_p0_application_contract.sql'),
      'utf8',
    );
    for (const field of [
      'has_invite_code',
      'normalized_phone',
      'idempotency_key',
      'terms_bundle_version',
    ]) {
      expect(route).toContain(field);
      expect(migration).toContain(field);
    }
    expect(migration).toContain('affiliate_applications_active_phone_uq');
    expect(migration).toContain('affiliate_applications_idempotency_key_uq');
  });
});
