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

describe('content-hub admin authorization contract', () => {
  it.each([
    ['src/app/api/content-hub/route.ts', ['GET', 'PATCH', 'DELETE']],
    ['src/app/api/content-hub/generate/route.ts', ['POST']],
    ['src/app/api/content-hub/publish/route.ts', ['POST']],
  ])('guards every handler in %s before service-role access', (path, methods) => {
    const route = source(path);
    expect(route).toContain("from '@/lib/admin-guard'");

    for (const method of methods) {
      const handler = handlerSource(route, method);
      const guardIndex = handler.indexOf('await requireAdminRequest(request)');
      const firstSensitiveIndex = [
        handler.indexOf('isSupabaseConfigured'),
        handler.indexOf('request.json'),
        handler.indexOf('supabaseAdmin'),
      ].filter((index) => index >= 0).sort((a, b) => a - b)[0];

      expect(handler, `${path} ${method}`).not.toBe('');
      expect(guardIndex, `${path} ${method}`).toBeGreaterThanOrEqual(0);
      expect(handler.slice(guardIndex, firstSensitiveIndex)).toContain('if (authError) return authError');
      expect(firstSensitiveIndex, `${path} ${method}`).toBeGreaterThan(guardIndex);
    }
  });

  it('does not allow raw PATCH to mutate lifecycle status', () => {
    const route = source('src/app/api/content-hub/route.ts');
    const patch = handlerSource(route, 'PATCH');
    const updateIndex = patch.indexOf(".from('content_creatives')");

    expect(patch).toContain("Object.prototype.hasOwnProperty.call(body, 'status')");
    expect(patch.indexOf("Object.prototype.hasOwnProperty.call(body, 'status')")).toBeLessThan(updateIndex);
    expect(patch).not.toContain('updateData.status');
    expect(patch).toContain(".select('id, status')");
    expect(patch).toContain("existing[0].status !== 'draft'");
    expect(patch).toContain(".eq('status', 'draft')");
    expect(patch).toContain(".select('id')");
    expect(patch).toContain("status: 404");
  });

  it('uses an explicit transition and optimistic current-state check for publish actions', () => {
    const route = source('src/app/api/content-hub/publish/route.ts');
    const post = handlerSource(route, 'POST');
    const actionIndex = post.indexOf('isContentHubAction(action)');
    const readIndex = post.indexOf(".from('content_creatives')");
    const transitionIndex = post.indexOf('resolveContentHubStatusTransition');
    const updateIndex = post.lastIndexOf(".from('content_creatives')");

    expect(actionIndex).toBeGreaterThanOrEqual(0);
    expect(actionIndex).toBeLessThan(readIndex);
    expect(transitionIndex).toBeGreaterThan(readIndex);
    expect(updateIndex).toBeGreaterThan(transitionIndex);
    expect(post.slice(updateIndex)).toContain(".eq('status', row.status)");
    expect(post.slice(updateIndex)).toContain(".select('id')");
  });

  it('runs all informational publish gates before the status update', () => {
    const route = source('src/app/api/content-hub/publish/route.ts');
    const post = handlerSource(route, 'POST');
    const updateIndex = post.lastIndexOf(".from('content_creatives')");

    expect(post.indexOf('getInformationalReviewBlockReason')).toBeLessThan(updateIndex);
    expect(post.indexOf('prepareBlogForPublish')).toBeLessThan(updateIndex);
    expect(post.indexOf('evaluateBlogInformationClaimPublishGate')).toBeLessThan(updateIndex);
    expect(post.indexOf('ensureBlogInformationRepresentativeForPublish')).toBeLessThan(updateIndex);
  });

  it('uses no-store for the protected creative list and preserves the product generation gate', () => {
    const listRoute = source('src/app/api/content-hub/route.ts');
    const generateRoute = source('src/app/api/content-hub/generate/route.ts');

    expect(handlerSource(listRoute, 'GET')).toContain("'Cache-Control': 'no-store'");
    expect(generateRoute).toContain('loadPublicContentPackageForGeneration(product_id)');
  });
});
