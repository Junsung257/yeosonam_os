import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

type GuardedRoute = {
  label: string;
  routePath: string;
  handler: 'POST';
  sensitiveNeedles: string[];
};

const guardedRoutes: GuardedRoute[] = [
  {
    label: 'free-travel product assembly',
    routePath: 'src/app/api/products/assemble-free-travel/route.ts',
    handler: 'POST',
    sensitiveNeedles: ['isSupabaseConfigured', 'request.json', 'supabaseAdmin'],
  },
  {
    label: 'package marketing copy regeneration',
    routePath: 'src/app/api/packages/[id]/regenerate-copies/route.ts',
    handler: 'POST',
    sensitiveNeedles: [
      'loadPublicContentPackageForGeneration',
      'generateMarketingCopies',
      'supabaseAdmin',
    ],
  },
  {
    label: 'card-news variant creation',
    routePath: 'src/app/api/card-news/[id]/create-variant/route.ts',
    handler: 'POST',
    sensitiveNeedles: ['isSupabaseConfigured', 'request.json', 'supabaseAdmin'],
  },
  {
    label: 'card-news variant winner decision',
    routePath: 'src/app/api/card-news/variants/[group_id]/decide-winner/route.ts',
    handler: 'POST',
    sensitiveNeedles: ['isSupabaseConfigured', 'request.json', 'detectVariantWinner'],
  },
];

function readRoute(routePath: string): string {
  return fs.readFileSync(path.join(repoRoot, routePath), 'utf8');
}

function handlerSource(source: string, handler: GuardedRoute['handler']): string {
  const start = source.indexOf(`export async function ${handler}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextHandler = source.slice(start + 1).search(/\nexport async function /);
  return nextHandler === -1 ? source.slice(start) : source.slice(start, start + 1 + nextHandler);
}

describe('admin-only creation APIs', () => {
  it.each(guardedRoutes)('requires admin before side effects: $label', (route) => {
    const source = readRoute(route.routePath);
    expect(source).toContain("import { requireAdminRequest } from '@/lib/admin-guard'");

    const handler = handlerSource(source, route.handler);
    const guardIndex = handler.indexOf('await requireAdminRequest(request)');
    expect(guardIndex).toBeGreaterThanOrEqual(0);

    for (const needle of route.sensitiveNeedles) {
      const sensitiveIndex = handler.indexOf(needle);
      expect(sensitiveIndex).toBeGreaterThanOrEqual(0);
      expect(guardIndex).toBeLessThan(sensitiveIndex);
    }
  });
});
