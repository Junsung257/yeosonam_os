import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function handlerSource(route: string, method: string): string {
  const start = route.indexOf(`export async function ${method}`);
  if (start < 0) return '';
  const nextHandler = route.indexOf('export async function ', start + 1);
  return route.slice(start, nextHandler < 0 ? route.length : nextHandler);
}

const adminOnlyMutationRoutes = [
  { path: 'src/app/api/meta/campaigns/route.ts', methods: ['GET', 'POST'] },
  { path: 'src/app/api/meta/campaigns/[id]/route.ts', methods: ['GET', 'PATCH', 'DELETE'] },
  { path: 'src/app/api/meta/creatives/route.ts', methods: ['GET', 'POST'] },
  { path: 'src/app/api/meta/creatives/deploy/route.ts', methods: ['POST'] },
  { path: 'src/app/api/meta/performance/route.ts', methods: ['GET', 'POST'] },
  { path: 'src/app/api/card-news/[id]/confirm/route.ts', methods: ['POST'] },
];

describe('marketing external-write route authorization contract', () => {
  it.each(adminOnlyMutationRoutes)('$path guards protected mutation handlers before body, DB, or provider work', ({ path, methods }) => {
    const route = source(path);
    expect(route).toContain("from '@/lib/admin-guard'");

    for (const method of methods) {
      const handler = handlerSource(route, method);
      const guardIndex = handler.indexOf('await requireAdminRequest(request)');
      const bodyIndex = handler.indexOf('request.json');
      const supabaseIndex = handler.indexOf('isSupabaseConfigured');
      const providerIndex = [
        'createMetaCampaign',
        'createAdSet',
        'uploadCreativeToMeta',
        'createAd',
        'upsertCampaign',
        'upsertCardNews',
        'upsertAdPerformanceSnapshot',
      ]
        .map((needle) => handler.indexOf(needle))
        .filter((index) => index >= 0)
        .sort((a, b) => a - b)[0];
      const sensitiveIndexes = [bodyIndex, supabaseIndex, providerIndex]
        .filter((index): index is number => typeof index === 'number' && index >= 0)
        .sort((a, b) => a - b);
      expect(sensitiveIndexes.length, `${path} ${method}`).toBeGreaterThan(0);
      const firstSensitiveIndex = sensitiveIndexes[0]!;

      expect(handler, `${path} ${method}`).not.toBe('');
      expect(guardIndex, `${path} ${method}`).toBeGreaterThanOrEqual(0);
      expect(handler.slice(guardIndex, firstSensitiveIndex)).toContain('if (authError) return authError');
      expect(firstSensitiveIndex, `${path} ${method}`).toBeGreaterThan(guardIndex);
    }
  });

  it('allows Meta optimize only for cron or admin before spend-affecting campaign work', () => {
    const route = source('src/app/api/meta/optimize/route.ts');
    const handler = handlerSource(route, 'POST');
    const cronIndex = handler.indexOf('isCronAuthorized(request)');
    const adminIndex = handler.indexOf('await requireAdminRequest(request)');
    const campaignIndex = handler.indexOf("getAdCampaigns({ status: 'ACTIVE' })");

    expect(route).toContain("from '@/lib/cron-auth'");
    expect(route).toContain("from '@/lib/admin-guard'");
    expect(cronIndex).toBeGreaterThanOrEqual(0);
    expect(adminIndex).toBeGreaterThan(cronIndex);
    expect(campaignIndex).toBeGreaterThan(adminIndex);
  });

  it('keeps Instagram publish behind admin or cron before service-role access', () => {
    const route = source('src/app/api/card-news/[id]/publish-instagram/route.ts');
    const handler = handlerSource(route, 'POST');
    const cronIndex = handler.indexOf('isCronAuthorized(request)');
    const adminIndex = handler.indexOf('await requireAdminRequest(request)');
    const bodyIndex = handler.indexOf('request.json');
    const serviceRoleIndex = handler.indexOf('supabaseAdmin');

    expect(route).toContain("from '@/lib/cron-auth'");
    expect(route).toContain("from '@/lib/admin-guard'");
    expect(cronIndex).toBeGreaterThanOrEqual(0);
    expect(adminIndex).toBeGreaterThan(cronIndex);
    expect(bodyIndex).toBeGreaterThan(adminIndex);
    expect(serviceRoleIndex).toBeGreaterThan(adminIndex);
  });

  it('forwards CRON_SECRET when cron/internal publishers bridge to protected routes', () => {
    const metaCron = source('src/app/api/cron/meta-optimize/route.ts');
    const distributionPublisher = source('src/lib/social-publishing/distribution-publisher.ts');

    expect(metaCron).toContain("getSecret('CRON_SECRET')");
    expect(metaCron).toContain('Authorization: `Bearer ${cronSecret}`');
    expect(distributionPublisher).toContain("getSecret('CRON_SECRET')");
    expect(distributionPublisher).toContain('Authorization: `Bearer ${cronSecret}`');
  });
});
