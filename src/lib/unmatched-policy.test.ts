import { describe, expect, it } from 'vitest';
import { canCreateAttractionViaReconcileAction } from './unmatched-policy';

describe('unmatched-policy SSOT', () => {
  it('blocks attraction creation from unmatched reconcile actions', () => {
    expect(canCreateAttractionViaReconcileAction()).toBe(false);
  });
});
