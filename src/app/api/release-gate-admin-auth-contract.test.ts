import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function handlerBody(route: string, method: string): string {
  const routeSource = source(route);
  const functionMarker = `export async function ${method}`;
  const constMarker = `const ${method.toLowerCase()}Handler`;
  const start = Math.max(routeSource.indexOf(functionMarker), routeSource.indexOf(constMarker));
  expect(start, `${route} ${method} handler`).toBeGreaterThanOrEqual(0);
  const nextExport = routeSource.indexOf('\nexport ', start + 1);
  return routeSource.slice(start, nextExport === -1 ? undefined : nextExport);
}

function expectAdminGuardBefore(body: string, sink: string) {
  const guard = body.indexOf('await requireAdminRequest(request)');
  const wrapped = body.includes('withAdminGuard(');
  expect(guard >= 0 || wrapped).toBe(true);
  if (!wrapped) {
    expect(guard).toBeLessThan(body.indexOf(sink));
  }
}

describe('release gate: platform-admin authorization boundaries', () => {
  it('checks the admin page authorization boundary before accepting a generic session JWT', () => {
    const middleware = source('src/middleware.ts');
    const adminBoundary = middleware.indexOf('if (isAdminPath)');
    const adminCheck = middleware.indexOf('requireAdminRequest(request)', adminBoundary);
    const genericJwtPass = middleware.indexOf('accessTokenAllowsRequest(token)', adminBoundary);

    expect(adminBoundary).toBeGreaterThanOrEqual(0);
    expect(adminCheck).toBeGreaterThan(adminBoundary);
    expect(genericJwtPass).toBeGreaterThan(adminCheck);
  });

  it.each(['POST', 'PATCH', 'DELETE'])('guards %s /api/packages before mutation input or DB work', (method) => {
    const body = handlerBody('src/app/api/packages/route.ts', method);
    expectAdminGuardBefore(body, method === 'DELETE' ? 'searchParams' : 'request.json');
  });

  it('never puts the authenticated package payload in a shared cache', () => {
    const route = source('src/app/api/packages/route.ts');
    expect(route).toContain("const ADMIN_PACKAGE_CACHE_CONTROL = 'private, no-store'");
    expect(route).toContain('if (isAdmin)');
    expect(route).toContain("response.headers.set('Cache-Control', ADMIN_PACKAGE_CACHE_CONTROL)");
  });

  it('guards dashboard financial KPIs and returns them with no-store', () => {
    const route = source('src/app/api/dashboard/route.ts');
    expect(route).toContain("import { withAdminGuard } from '@/lib/admin-guard'");
    expect(route).toContain('export const GET = withAdminGuard(');
    expect(route).toContain("'Cache-Control': 'private, no-store'");
  });

  it.each([
    ['src/app/api/capital/route.ts', 'GET', 'supabaseAdmin'],
    ['src/app/api/capital/route.ts', 'POST', 'request.json'],
    ['src/app/api/capital/route.ts', 'DELETE', 'searchParams'],
    ['src/app/api/agent-actions/route.ts', 'GET', 'supabaseAdmin'],
    ['src/app/api/agent-actions/route.ts', 'POST', 'request.json'],
  ])('guards %s %s before sensitive work', (route, method, sink) => {
    expectAdminGuardBefore(handlerBody(route, method), sink);
  });
});
