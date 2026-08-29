import { describe, expect, it } from 'vitest';

import { isValidNaverIndexNowKey } from './indexnow-key';

describe('isValidNaverIndexNowKey', () => {
  it('accepts a 32-character hexadecimal key', () => {
    expect(isValidNaverIndexNowKey('2bf8a3e47c1d9f6e0b5a20260829abcd')).toBe(true);
  });

  it('accepts a UUID-shaped hexadecimal key', () => {
    expect(isValidNaverIndexNowKey('2bf8a3e4-7c1d-9f6e-0b5a-20260829abcd')).toBe(true);
  });

  it('rejects letters outside the hexadecimal range and underscores', () => {
    expect(isValidNaverIndexNowKey('test-indexnow-key_123')).toBe(false);
  });
});

