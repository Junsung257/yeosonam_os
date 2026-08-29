import { describe, expect, it } from 'vitest';

import { isValidNaverIndexNowKey } from './indexnow-key';

describe('isValidNaverIndexNowKey', () => {
  it('accepts a hexadecimal key', () => {
    expect(isValidNaverIndexNowKey('deadbeef')).toBe(true);
  });

  it('accepts a UUID-shaped hexadecimal key', () => {
    expect(isValidNaverIndexNowKey('deadbeef-deadbeef')).toBe(true);
  });

  it('rejects letters outside the hexadecimal range and underscores', () => {
    expect(isValidNaverIndexNowKey('test-indexnow-key_123')).toBe(false);
  });
});
