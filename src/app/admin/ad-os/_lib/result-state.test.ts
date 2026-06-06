import { describe, expect, it } from 'vitest';
import {
  INITIAL_AD_OS_RESULT_STATE,
  reduceAdOsResultState,
} from './result-state';

describe('Ad OS result state reducer', () => {
  it('patches only the requested result fields', () => {
    const next = reduceAdOsResultState(INITIAL_AD_OS_RESULT_STATE, {
      type: 'patch',
      patch: {
        automationMessage: 'Action completed.',
        tenantReport: { ok: true },
      },
    });

    expect(next.automationMessage).toBe('Action completed.');
    expect(next.tenantReport).toEqual({ ok: true });
    expect(next.launchAudit).toBeNull();
    expect(next.stagingSmoke).toBeNull();
  });

  it('resets result fields back to their empty values', () => {
    const populated = reduceAdOsResultState(INITIAL_AD_OS_RESULT_STATE, {
      type: 'patch',
      patch: {
        automationMessage: 'Ready',
        keywordBrainResult: { ok: true },
      },
    });

    expect(reduceAdOsResultState(populated, { type: 'reset' })).toEqual(INITIAL_AD_OS_RESULT_STATE);
  });
});
