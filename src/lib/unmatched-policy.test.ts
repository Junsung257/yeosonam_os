import { describe, expect, it } from 'vitest';
import { canCreateAttractionViaReconcileAction } from './unmatched-policy';

describe('unmatched-policy SSOT', () => {
  it('allows reconcile create action only through admin-manual channel policy', () => {
    expect(canCreateAttractionViaReconcileAction()).toBe(true);
  });
});
