import { afterEach, describe, expect, it } from 'vitest';

import { loadProductRegistrationV6PublicationBlockers } from './publication-control';

const ENV_NAMES = [
  'PRODUCT_REGISTRATION_AUTHORITY_MODE',
  'PRODUCT_REGISTRATION_V6_PUBLISH_ENABLED',
  'PRODUCT_REGISTRATION_PUBLICATION_FREEZE',
  'PRODUCT_REGISTRATION_SOURCE_PROOF_AUTO_PUBLISH',
] as const;

const originalEnv = Object.fromEntries(ENV_NAMES.map(name => [name, process.env[name]]));

function fakeSupabase(switches: unknown[] = []) {
  const query = {
    select: () => query,
    eq: () => query,
    or: async () => ({ data: switches, error: null }),
  };
  return { from: () => query } as never;
}

afterEach(() => {
  for (const name of ENV_NAMES) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('source-proof publication control', () => {
  it('does not weaken the normal publication freeze', async () => {
    process.env.PRODUCT_REGISTRATION_AUTHORITY_MODE = 'shadow';
    process.env.PRODUCT_REGISTRATION_PUBLICATION_FREEZE = '1';
    delete process.env.PRODUCT_REGISTRATION_SOURCE_PROOF_AUTO_PUBLISH;

    await expect(loadProductRegistrationV6PublicationBlockers({
      supabase: fakeSupabase(),
      catalogProductIds: ['catalog-1'],
    })).resolves.toContain('PUBLICATION_FREEZE_ACTIVE');
  });

  it('lets an opted-in workflow reach the source-proof CAS writer', async () => {
    process.env.PRODUCT_REGISTRATION_AUTHORITY_MODE = 'shadow';
    process.env.PRODUCT_REGISTRATION_PUBLICATION_FREEZE = '1';
    process.env.PRODUCT_REGISTRATION_SOURCE_PROOF_AUTO_PUBLISH = '1';

    await expect(loadProductRegistrationV6PublicationBlockers({
      supabase: fakeSupabase(),
      catalogProductIds: ['catalog-1'],
      allowSourceProofAutoPublish: true,
    })).resolves.toEqual([]);
  });

  it('keeps a kill switch hard even in source-proof mode', async () => {
    process.env.PRODUCT_REGISTRATION_AUTHORITY_MODE = 'shadow';
    process.env.PRODUCT_REGISTRATION_PUBLICATION_FREEZE = '1';
    process.env.PRODUCT_REGISTRATION_SOURCE_PROOF_AUTO_PUBLISH = '1';

    await expect(loadProductRegistrationV6PublicationBlockers({
      supabase: fakeSupabase([{ scope: 'global', scope_key: '*', reason: 'incident' }]),
      catalogProductIds: ['catalog-1'],
      allowSourceProofAutoPublish: true,
    })).resolves.toContain('KILL_SWITCH:global:*:incident');
  });
});
