import { describe, expect, it } from 'vitest';
import { assertTerminalNotReopened, isActiveUnmatched, isTerminalUnmatched } from './unmatched-lifecycle';

describe('unmatched lifecycle guards', () => {
  it('defines the active queue as pending without resolved_at', () => {
    expect(isActiveUnmatched({ status: 'pending', resolved_at: null })).toBe(true);
    expect(isActiveUnmatched({ status: 'pending', resolved_at: '2026-06-16T00:00:00Z' })).toBe(false);
    expect(isActiveUnmatched({ status: 'added', resolved_at: null })).toBe(false);
  });

  it('treats added, ignored, or resolved_at rows as terminal', () => {
    expect(isTerminalUnmatched({ status: 'added', resolved_at: null })).toBe(true);
    expect(isTerminalUnmatched({ status: 'ignored', resolved_at: null })).toBe(true);
    expect(isTerminalUnmatched({ status: 'pending', resolved_at: '2026-06-16T00:00:00Z' })).toBe(true);
  });

  it('rejects pending rows that already have resolved_at', () => {
    expect(() => assertTerminalNotReopened({
      status: 'pending',
      resolved_at: '2026-06-16T00:00:00Z',
    })).toThrow(/pending row cannot have resolved_at/);
  });
});
