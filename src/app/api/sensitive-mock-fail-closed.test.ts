import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sensitiveBackendUnavailable } from '@/lib/sensitive-api-fail-closed';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const sensitiveRoutes = [
  'src/app/api/rfq/route.ts',
  'src/app/api/rfq/[id]/route.ts',
  'src/app/api/rfq/[id]/messages/route.ts',
  'src/app/api/rfq/[id]/bid/route.ts',
  'src/app/api/rfq/[id]/proposals/route.ts',
  'src/app/api/rfq/[id]/analyze/route.ts',
  'src/app/api/rfq/[id]/contract/route.ts',
  'src/app/api/secure-chat/route.ts',
  'src/app/api/tenant/rfqs/route.ts',
  'src/app/api/tenant/rfqs/[rfqId]/route.ts',
  'src/app/api/voucher/route.ts',
];

describe('sensitive API missing-backend boundaries', () => {
  it('does not expose mock success fallbacks for sensitive customer, tenant, or document routes', () => {
    for (const routePath of sensitiveRoutes) {
      const route = source(routePath);

      expect(route, routePath).toContain('sensitiveBackendUnavailable');
      expect(route, routePath).not.toContain('mock: true');
      expect(route, routePath).not.toMatch(/\bMOCK_/);
      expect(route, routePath).not.toMatch(/mock-[a-z]/);
      expect(route, routePath).not.toContain('mockVoucher');
    }
  });

  it('checks backend configuration before parsing sensitive POST bodies', () => {
    for (const routePath of [
      'src/app/api/rfq/route.ts',
      'src/app/api/rfq/[id]/messages/route.ts',
      'src/app/api/rfq/[id]/bid/route.ts',
      'src/app/api/secure-chat/route.ts',
      'src/app/api/voucher/route.ts',
    ]) {
      const route = source(routePath);
      const postStart = route.indexOf('export async function POST');
      const postBody = route.slice(postStart);

      expect(postStart, routePath).toBeGreaterThanOrEqual(0);
      expect(postBody.indexOf('if (!isSupabaseConfigured)'), routePath).toBeGreaterThanOrEqual(0);
      expect(postBody.indexOf('if (!isSupabaseConfigured)'), routePath).toBeLessThan(
        postBody.indexOf('request.json()'),
      );
    }
  });

  it('returns a 503 private no-store response for missing sensitive backends', async () => {
    const response = sensitiveBackendUnavailable('rfq messages');

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ error: 'RFQ_MESSAGES_UNAVAILABLE' });
  });
});
