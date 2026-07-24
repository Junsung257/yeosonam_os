import { describe, expect, it } from 'vitest';
import {
  isGa4ProductionHost,
  isGa4PublicPath,
  normalizeGa4MeasurementId,
} from './ga4';

describe('GA4 runtime guard', () => {
  it('accepts and normalizes a valid GA4 measurement ID', () => {
    expect(normalizeGa4MeasurementId(' g-abc123def4 ')).toBe('G-ABC123DEF4');
  });

  it('rejects malformed or injectable measurement IDs', () => {
    expect(normalizeGa4MeasurementId(undefined)).toBeNull();
    expect(normalizeGa4MeasurementId('UA-12345-1')).toBeNull();
    expect(normalizeGa4MeasurementId("G-ABC123');alert(1)//")).toBeNull();
  });

  it('allows only the customer production domains', () => {
    expect(isGa4ProductionHost('yeosonam.com')).toBe(true);
    expect(isGa4ProductionHost('WWW.YEOSONAM.COM')).toBe(true);
    expect(isGa4ProductionHost('localhost')).toBe(false);
    expect(isGa4ProductionHost('preview-branch.vercel.app')).toBe(false);
  });

  it('excludes admin surfaces from customer traffic', () => {
    expect(isGa4PublicPath('/')).toBe(true);
    expect(isGa4PublicPath('/blog/guam-guide')).toBe(true);
    expect(isGa4PublicPath('/admin')).toBe(false);
    expect(isGa4PublicPath('/admin/blog')).toBe(false);
    expect(isGa4PublicPath('/m/admin')).toBe(false);
  });
});
