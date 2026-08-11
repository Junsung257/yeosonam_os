import { describe, expect, it } from 'vitest';

import {
  PLATFORM_PRODUCT_REGISTRATION_TENANT_ID,
  parseProductRegistrationTenantId,
} from './types';

describe('parseProductRegistrationTenantId', () => {
  it('accepts the reserved platform tenant used by the database contract', () => {
    expect(parseProductRegistrationTenantId(PLATFORM_PRODUCT_REGISTRATION_TENANT_ID))
      .toBe(PLATFORM_PRODUCT_REGISTRATION_TENANT_ID);
  });

  it('accepts regular RFC UUID tenant identities', () => {
    expect(parseProductRegistrationTenantId('550e8400-e29b-41d4-a716-446655440000'))
      .toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('rejects empty and malformed tenant identities', () => {
    expect(parseProductRegistrationTenantId('')).toBeNull();
    expect(parseProductRegistrationTenantId('not-a-tenant')).toBeNull();
  });
});
