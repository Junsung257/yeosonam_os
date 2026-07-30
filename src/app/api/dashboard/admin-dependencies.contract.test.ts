import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const adminOnlyRoutes = [
  '../agent-actions/route.ts',
  '../capital/route.ts',
  '../admin/badge-counts/route.ts',
  '../admin/ai-credits/route.ts',
];

describe('admin dashboard dependency availability contract', () => {
  it.each(adminOnlyRoutes)('%s never represents a missing admin DB as healthy zero data', (relativePath) => {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');

    expect(source).toContain('isSupabaseAdminConfigured');
    expect(source).toContain('status: 503');
  });

  it('requires the admin database for the admin package queue while preserving the public route fallback', () => {
    const source = readFileSync(new URL('../packages/route.ts', import.meta.url), 'utf8');

    expect(source).toContain('isAdmin && !isSupabaseAdminConfigured');
    expect(source).toContain("ApiErrors.unavailable('Supabase admin connection is not configured.')");
    expect(source).toContain('if (!isSupabaseConfigured)');
  });
});
