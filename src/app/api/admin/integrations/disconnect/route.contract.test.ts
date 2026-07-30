import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('admin integration disconnect contract', () => {
  it('never reports a simulated disconnect as successful', () => {
    const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');

    expect(source).toContain('isSupabaseAdminConfigured');
    expect(source).toContain('status: 503');
    expect(source).not.toContain('success: true, mock: true');
  });
});
