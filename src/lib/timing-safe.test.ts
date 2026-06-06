import { describe, expect, it } from 'vitest';
import { safeEqualString } from './timing-safe';

describe('safeEqualString', () => {
  it('accepts equal strings', () => {
    expect(safeEqualString('secret-token', 'secret-token')).toBe(true);
  });

  it('rejects different strings with the same byte length', () => {
    expect(safeEqualString('secret-token-a', 'secret-token-b')).toBe(false);
  });

  it('rejects nullish or different-length inputs', () => {
    expect(safeEqualString(null, 'secret-token')).toBe(false);
    expect(safeEqualString('secret', undefined)).toBe(false);
    expect(safeEqualString('secret-token', 'secret')).toBe(false);
  });

  it('compares multibyte strings by bytes', () => {
    expect(safeEqualString('여소남-token', '여소남-token')).toBe(true);
    expect(safeEqualString('여소남-token', '여소남-tokem')).toBe(false);
  });
});
