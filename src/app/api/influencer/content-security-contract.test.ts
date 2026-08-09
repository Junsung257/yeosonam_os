import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/influencer/content/route.ts'),
  'utf8',
);

describe('legacy influencer content bridge security contract', () => {
  it('does not return raw generation/provider errors', () => {
    expect(routeSource).toContain("logAndSanitize('influencer-content-post'");
    expect(routeSource).toContain("code: 'CONTENT_GENERATION_FAILED'");
    expect(routeSource).not.toContain('return NextResponse.json({ error: msg }');
  });
});
