import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('public lead API error boundary', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/api/leads/route.ts'), 'utf8');

  it('does not return raw database or runtime error messages', () => {
    expect(source).not.toContain('ApiErrors.internalError(error.message)');
    expect(source).not.toContain("ApiErrors.internalError(err instanceof Error ? err.message");
  });

  it('returns a stable code, request id, and no-store response', () => {
    expect(source).toContain("code: 'LEAD_SAVE_FAILED'");
    expect(source).toContain("code: 'LEAD_REQUEST_FAILED'");
    expect(source).toContain('requestId');
    expect(source).toContain("'Cache-Control': 'no-store'");
  });
});
