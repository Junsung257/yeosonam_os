import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

describe('google oauth callback analytics token contract', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/api/auth/google-callback/route.ts'), 'utf8');

  it('persists a separate Google Analytics token when analytics.readonly scope is granted', () => {
    expect(source).toContain("GOOGLE_ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'");
    expect(source).toContain("saveOAuthToken(tenantId, 'google_analytics'");
  });

  it('keeps Google Ads token persistence separate from Google Analytics', () => {
    expect(source).toContain("GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords'");
    expect(source).toContain("saveOAuthToken(tenantId, 'google_ads'");
  });
});
