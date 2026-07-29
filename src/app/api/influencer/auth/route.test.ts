import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');

describe('influencer authentication error boundary', () => {
  it('never returns the caught internal error message to the client', () => {
    expect(source).not.toMatch(/error instanceof Error\s*\?\s*error\.message/);
    expect(source).toContain("code: 'INFLUENCER_AUTH_FAILED'");
    expect(source).toContain("headers: { 'Cache-Control': 'no-store' }");
    expect(source).toContain('requestId');
  });
});
