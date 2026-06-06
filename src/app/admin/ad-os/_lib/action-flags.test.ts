import { describe, expect, it } from 'vitest';
import { ACTION_FLAG_KEYS, INITIAL_ACTION_FLAGS } from './action-flags';

describe('Ad OS action flags', () => {
  it('initializes every action flag to false', () => {
    expect(Object.keys(INITIAL_ACTION_FLAGS).sort()).toEqual([...ACTION_FLAG_KEYS].sort());
    expect(Object.values(INITIAL_ACTION_FLAGS).every((value) => value === false)).toBe(true);
  });
});
