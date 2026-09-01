import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const service = readFileSync('src/lib/blog-seo-weekly-audit-v4.ts', 'utf8');
const route = readFileSync('src/app/api/cron/blog-seo-weekly-audit/route.ts', 'utf8');
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: Array<{ path: string; schedule: string }> };

describe('Blog SEO weekly audit V4 wiring', () => {
  it('uses a protected bounded weekly route and one schedule', () => {
    expect(route).toContain('isCronOrVercelAuthorized');
    expect(service).toContain('const MAX_CATALOG_POSTS = 500');
    expect(service).toContain('const PUBLIC_RENDER_SAMPLE_SIZE = 30');
    expect(service).toContain('const PAGESPEED_SAMPLE_SIZE = 4');
    expect(vercel.crons.filter((cron) => cron.path === '/api/cron/blog-seo-weekly-audit')).toEqual([
      { path: '/api/cron/blog-seo-weekly-audit', schedule: '30 18 * * 0' },
    ]);
  });

  it('is observation-only and stores provider receipts', () => {
    expect(service).toContain('automatic_content_changes: 0');
    expect(service).toContain('provider_receipts');
    expect(service).not.toContain(".from('content_creatives').update(");
    expect(service).not.toContain(".from('content_creatives').delete(");
  });
});
