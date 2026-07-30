import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('admin badge count accuracy contract', () => {
  it('shows unavailable data as an error instead of healthy zero counts', () => {
    const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');

    expect(source).toContain('isSupabaseAdminConfigured');
    expect(source).toContain('status: 503');
    expect(source).toContain('throw new Error');
    expect(source).not.toContain('console.warn(`[badge-counts] optional count failed');
  });
});
