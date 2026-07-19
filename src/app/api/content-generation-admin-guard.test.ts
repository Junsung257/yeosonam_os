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

const protectedContentHandlers = [
  { path: 'src/app/api/content-brief/route.ts', methods: ['POST'] },
  { path: 'src/app/api/content/instagram-caption/route.ts', methods: ['POST'] },
  { path: 'src/app/api/content/threads-post/route.ts', methods: ['POST'] },
  { path: 'src/app/api/content/meta-ads/route.ts', methods: ['POST'] },
  { path: 'src/app/api/content/google-ads-rsa/route.ts', methods: ['POST'] },
  { path: 'src/app/api/content/kakao-channel/route.ts', methods: ['POST'] },
  { path: 'src/app/api/content/blog-body/route.ts', methods: ['POST'] },
  { path: 'src/app/api/content/cover-critic/route.ts', methods: ['POST'] },
  { path: 'src/app/api/content/generate-all/route.ts', methods: ['GET', 'POST'] },
  { path: 'src/app/api/orchestrator/auto-publish/route.ts', methods: ['POST'] },
];

describe('content generation route authorization contract', () => {
  it.each(protectedContentHandlers)('$path guards admin-only content handlers before sensitive work', ({ path, methods }) => {
    const route = source(path);
    expect(route).toContain("from '@/lib/admin-guard'");

    for (const method of methods) {
      const handler = handlerSource(route, method);
      expect(handler, `${path} ${method}`).not.toBe('');

      const guardIndex = handler.indexOf('await requireAdminRequest(request)');
      const sensitiveIndexes = [
        'request.json',
        'isSupabaseConfigured',
        'supabaseAdmin',
        'loadPublicContentPackageForGeneration',
        'generateContentBrief',
        'generateInstagramCaption',
        'generateThreadsPost',
        'generateMetaAds',
        'generateGoogleAdsRSA',
        'generateKakaoChannelMessage',
        'generateBlogBody',
        'critiqueCover',
        'publishDistribution',
      ]
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
});
