import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routes = [
  './dashboard/route.ts',
  './attribution/route.ts',
  './marketing-performance/route.ts',
];

describe('admin analytics fallback contract', () => {
  it.each(routes)('%s never presents mock data as live data', (relativePath) => {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');

    expect(source).toContain('isSupabaseAdminConfigured');
    expect(source).toContain("searchParams.get('demo') !== '1'");
    expect(source).toContain("status: 503");
  });
});
