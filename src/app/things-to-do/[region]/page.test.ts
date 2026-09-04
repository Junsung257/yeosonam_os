import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

describe('things-to-do region deployment contract', () => {
  it('uses a serverless handler for empty-params fallback routes', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/things-to-do/[region]/page.tsx'), 'utf8');
    expect(source).toContain("export const dynamic = 'force-dynamic'");
  });
});
