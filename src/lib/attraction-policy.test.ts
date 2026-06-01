import { describe, expect, it } from 'vitest';
import { canCreateAttractionRecord, shouldAllowAutoAttractionInsert } from './attraction-policy';

describe('attraction-policy SSOT', () => {
  it('denies auto insert by default', () => {
    expect(shouldAllowAutoAttractionInsert({})).toBe(false);
    expect(shouldAllowAutoAttractionInsert({ nodeEnv: 'production', allowAutoAttractionInsertEnv: '1' })).toBe(false);
    expect(shouldAllowAutoAttractionInsert({ nodeEnv: 'development', allowAutoAttractionInsertEnv: '1' })).toBe(false);
  });

  it('allows auto insert only in test with explicit opt-in', () => {
    expect(shouldAllowAutoAttractionInsert({ nodeEnv: 'test', allowAutoAttractionInsertEnv: '1' })).toBe(true);
    expect(shouldAllowAutoAttractionInsert({ nodeEnv: 'test', allowAutoAttractionInsertEnv: '0' })).toBe(false);
  });

  it('allows creation only for admin manual channel (or upload test opt-in)', () => {
    expect(canCreateAttractionRecord('admin_manual')).toBe(true);
    expect(canCreateAttractionRecord('cron')).toBe(false);
    expect(canCreateAttractionRecord('upload', { nodeEnv: 'production', allowAutoAttractionInsertEnv: '1' })).toBe(false);
    expect(canCreateAttractionRecord('upload', { nodeEnv: 'test', allowAutoAttractionInsertEnv: '1' })).toBe(true);
  });
});
