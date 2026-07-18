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

const guardedRoutes = [
  { path: 'src/app/api/blog/route.ts', methods: ['POST', 'PATCH'] },
  { path: 'src/app/api/blog/queue/route.ts', methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
  { path: 'src/app/api/blog/ad-mapping/route.ts', methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
  { path: 'src/app/api/blog/generate/route.ts', methods: ['POST'] },
  { path: 'src/app/api/blog/bulk-generate/route.ts', methods: ['POST'] },
  { path: 'src/app/api/blog/reindex/route.ts', methods: ['POST'] },
  { path: 'src/app/api/blog/bulk-reindex/route.ts', methods: ['POST'] },
  { path: 'src/app/api/blog/report-error/route.ts', methods: ['POST'] },
];

describe('blog service-role route authorization contract', () => {
  it.each(guardedRoutes)('$path guards every protected handler before DB or body work', ({ path, methods }) => {
    const route = source(path);
    expect(route).toContain("from '@/lib/admin-guard'");

    for (const method of methods) {
      const handler = handlerSource(route, method);
      const guardIndex = handler.indexOf('await requireAdminRequest(request)');
      const configuredIndex = handler.indexOf('isSupabaseConfigured');
      const bodyIndex = handler.indexOf('request.json');
      const serviceRoleIndex = handler.indexOf('supabaseAdmin');
      const firstSensitiveIndex = [configuredIndex, bodyIndex, serviceRoleIndex]
        .filter((index) => index >= 0)
        .sort((a, b) => a - b)[0];

      expect(handler, `${path} ${method}`).not.toBe('');
      expect(guardIndex, `${path} ${method}`).toBeGreaterThanOrEqual(0);
      expect(handler.slice(guardIndex, firstSensitiveIndex)).toContain('if (authError) return authError');
      expect(firstSensitiveIndex, `${path} ${method}`).toBeGreaterThan(guardIndex);
    }
  });

  it('requires admin or an explicit CRON_SECRET bridge before card-news service-role access', () => {
    const route = source('src/app/api/blog/from-card-news/route.ts');
    const handler = handlerSource(route, 'POST');

    expect(handler).toContain('cronBridgeAuthorized');
    expect(handler).toContain('await requireAdminRequest(request)');
    expect(handler.indexOf('await requireAdminRequest(request)')).toBeLessThan(handler.indexOf('request.json'));
    expect(handler.indexOf('request.json')).toBeLessThan(handler.indexOf('isSupabaseConfigured'));
    expect(handler).toContain('Boolean(publisher_bridge) !== cronBridgeAuthorized');
  });

  it('keeps MRT generation admin/cron-only and draft-only', () => {
    const route = source('src/app/api/blog/mrt-hotel-ranking/route.ts');
    const handler = handlerSource(route, 'POST');

    expect(handler).toContain('isCronAuthorized(request)');
    expect(handler).toContain('await requireAdminRequest(request)');
    expect(handler.indexOf('await requireAdminRequest(request)')).toBeLessThan(handler.indexOf('isSupabaseConfigured'));
    expect(handler).toContain('if (body.publish === true)');
    expect(handler).toContain("status: 'draft'");
    expect(handler).not.toContain("status: publish ? 'published' : 'draft'");
  });

  it('keeps only the documented public blog read APIs', () => {
    const middleware = source('src/middleware.ts');

    expect(middleware).not.toContain("'/api/blog/',");
    expect(middleware).toContain("pathname === '/api/blog'");
    expect(middleware).toContain("pathname === '/api/blog/image'");
    expect(middleware).not.toContain("pathname === '/api/blog/report-error'");
  });
});
