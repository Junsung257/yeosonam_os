import { describe, expect, it } from 'vitest';
import {
  buildRootMetadata,
  isApprovedProductionEnvironment,
  safeHttpOrigin,
} from './preview-metadata';

describe('preview metadata isolation', () => {
  it('fails closed outside an approved production host', () => {
    expect(isApprovedProductionEnvironment({
      vercelEnv: 'preview',
      siteUrl: 'https://www.yeosonam.com',
      requestHost: 'www.yeosonam.com',
    })).toBe(false);
    expect(isApprovedProductionEnvironment({
      vercelEnv: 'production',
      siteUrl: 'https://preview.example.vercel.app',
      requestHost: 'preview.example.vercel.app',
    })).toBe(false);
    expect(isApprovedProductionEnvironment({
      vercelEnv: 'production',
      siteUrl: 'https://www.yeosonam.com',
      requestHost: 'preview.example.vercel.app',
    })).toBe(false);
  });

  it('allows only the approved HTTPS production origins', () => {
    expect(isApprovedProductionEnvironment({
      vercelEnv: 'production',
      siteUrl: 'https://www.yeosonam.com',
      requestHost: 'www.yeosonam.com',
    })).toBe(true);
    expect(isApprovedProductionEnvironment({
      vercelEnv: 'production',
      siteUrl: 'https://yeosonam.com',
      requestHost: 'yeosonam.com:443',
    })).toBe(true);
    expect(isApprovedProductionEnvironment({
      vercelEnv: 'production',
      siteUrl: 'http://www.yeosonam.com',
      requestHost: 'www.yeosonam.com',
    })).toBe(false);
  });

  it('omits production identity metadata for Preview', () => {
    const metadata = buildRootMetadata({
      isApprovedProduction: false,
      siteUrl: 'https://www.yeosonam.com',
    });

    expect(metadata.metadataBase).toBeUndefined();
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph).toBeUndefined();
    expect(metadata.twitter).toBeUndefined();
    expect(metadata.verification).toBeUndefined();
    expect(metadata.robots).toMatchObject({ index: false, follow: false, noarchive: true, nosnippet: true });
  });

  it('preserves production identity metadata only after approval', () => {
    const metadata = buildRootMetadata({
      isApprovedProduction: true,
      siteUrl: 'https://www.yeosonam.com/path-that-is-ignored',
      googleVerification: 'google-token',
    });

    expect(metadata.metadataBase?.toString()).toBe('https://www.yeosonam.com/');
    expect(metadata.alternates?.canonical).toBe('https://www.yeosonam.com');
    expect(metadata.openGraph?.url).toBe('https://www.yeosonam.com');
    expect(metadata.verification).toMatchObject({ google: 'google-token' });
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });

  it('accepts only safe HTTP origins for connection hints', () => {
    expect(safeHttpOrigin('https://nwtmtksjedkqehgnrxij.supabase.co/rest/v1')).toBe(
      'https://nwtmtksjedkqehgnrxij.supabase.co',
    );
    expect(safeHttpOrigin('javascript:alert(1)')).toBeNull();
  });
});
