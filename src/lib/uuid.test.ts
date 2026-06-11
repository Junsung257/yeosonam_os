import { describe, expect, it } from 'vitest';
import { isUuid } from './uuid';

describe('isUuid', () => {
  it('accepts standard package UUIDs', () => {
    expect(isUuid('34fb83d2-8b76-410c-ae93-d8430c17e224')).toBe(true);
    expect(isUuid('34FB83D2-8B76-410C-AE93-D8430C17E224')).toBe(true);
  });

  it('rejects malformed IDs', () => {
    expect(isUuid('not-a-real-package')).toBe(false);
    expect(isUuid('34fb83d2-8b76-410c-ae93d8430c17e224')).toBe(false);
    expect(isUuid('34fb83d2-8b76-710c-ae93-d8430c17e224')).toBe(false);
  });
});
