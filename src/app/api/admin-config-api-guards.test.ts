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

const protectedHandlers = [
  { path: 'src/app/api/blog-categories/route.ts', methods: ['POST', 'PATCH', 'DELETE'] },
  { path: 'src/app/api/terms-templates/route.ts', methods: ['GET', 'POST'] },
  { path: 'src/app/api/terms-templates/[id]/route.ts', methods: ['GET', 'PATCH', 'DELETE'] },
  { path: 'src/app/api/prompts/route.ts', methods: ['GET', 'POST'] },
  { path: 'src/app/api/prompts/[key]/route.ts', methods: ['GET', 'PATCH'] },
  { path: 'src/app/api/prompts/[key]/invalidate/route.ts', methods: ['POST'] },
  { path: 'src/app/api/marketing-logs/route.ts', methods: ['GET', 'POST', 'DELETE'] },
  { path: 'src/app/api/competitor-ads/route.ts', methods: ['GET', 'POST'] },
  { path: 'src/app/api/content-calendar/reschedule/route.ts', methods: ['POST'] },
  { path: 'src/app/api/orchestrator/auto-publish-top/route.ts', methods: ['POST'] },
  { path: 'src/app/api/briefings/generate-ppt/route.ts', methods: ['POST'] },
];

const sensitiveNeedles = [
  'request.json',
  'req.json',
  'isSupabaseConfigured',
  'supabaseAdmin',
  ".from('",
  '.rpc(',
  'invalidatePromptCache',
  'getTopRecommendedPackages',
  'generateBriefingPPT',
];

describe('admin configuration API authorization boundary', () => {
  it.each(protectedHandlers)('$path requires admin before sensitive handler work', ({ path, methods }) => {
    const route = source(path);
    expect(route, path).toContain("from '@/lib/admin-guard'");

    for (const method of methods) {
      const handler = handlerSource(route, method);
      expect(handler, `${path} ${method}`).not.toBe('');

      const guardIndex = handler.indexOf('await requireAdminRequest(');
      const sensitiveIndexes = sensitiveNeedles
        .map((needle) => handler.indexOf(needle))
        .filter((index) => index >= 0)
        .sort((a, b) => a - b);

      expect(sensitiveIndexes.length, `${path} ${method}`).toBeGreaterThan(0);
      const firstSensitiveIndex = sensitiveIndexes[0]!;

      expect(guardIndex, `${path} ${method}`).toBeGreaterThanOrEqual(0);
      expect(handler.slice(guardIndex, firstSensitiveIndex), `${path} ${method}`).toContain('if (authError) return authError');
      expect(firstSensitiveIndex, `${path} ${method}`).toBeGreaterThan(guardIndex);
    }
  });

  it('keeps public active blog category reads open but protects inactive taxonomy reads', () => {
    const route = source('src/app/api/blog-categories/route.ts');
    const getHandler = handlerSource(route, 'GET');

    const includeInactiveIndex = getHandler.indexOf("include_inactive') === '1'");
    const guardIndex = getHandler.indexOf('await requireAdminRequest(request)', includeInactiveIndex);
    const queryIndex = getHandler.indexOf('.from(', includeInactiveIndex);

    expect(includeInactiveIndex).toBeGreaterThanOrEqual(0);
    expect(guardIndex).toBeGreaterThan(includeInactiveIndex);
    expect(getHandler.slice(guardIndex, queryIndex)).toContain('if (authError) return authError');
    expect(queryIndex).toBeGreaterThan(guardIndex);
  });
});
