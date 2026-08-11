import { describe, expect, it } from 'vitest';

import {
  describeRegistrationError,
  registrationDatabaseError,
  registrationErrorCode,
} from './errors';

describe('product registration errors', () => {
  it('preserves structured Supabase error fields', () => {
    const error = {
      code: 'P0001',
      message: 'golf_rounds is append-only',
      details: 'revision-1',
      hint: 'insert a new row',
    };
    expect(describeRegistrationError(error)).toBe(
      'P0001:golf_rounds is append-only:details=revision-1:hint=insert a new row',
    );
    expect(registrationErrorCode(error, 'FALLBACK')).toBe('P0001');
    expect(registrationDatabaseError('COMMIT_FAILED', error).message)
      .toContain('COMMIT_FAILED:P0001:golf_rounds is append-only');
  });

  it('never persists an opaque object string', () => {
    expect(describeRegistrationError({})).toBe('REGISTRATION_UNKNOWN_STRUCTURED_ERROR');
    expect(registrationErrorCode({}, 'CANONICAL_NORMALIZATION_FAILED'))
      .toBe('REGISTRATION_UNKNOWN_STRUCTURED_ERROR');
  });
});
