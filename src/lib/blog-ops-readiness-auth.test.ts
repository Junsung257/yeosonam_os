import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('blog ops strict readiness authentication contract', () => {
  it('keeps bearer secrets in GitHub Secrets rather than Variables', () => {
    const workflow = read('.github/workflows/open-readiness.yml');

    expect(workflow).toContain('BLOG_OPS_READ_TOKEN: ${{ secrets.BLOG_OPS_READ_TOKEN }}');
    expect(workflow).toContain('CRON_SECRET: ${{ secrets.CRON_SECRET }}');
    expect(workflow).not.toContain('vars.BLOG_OPS_READ_TOKEN');
    expect(workflow).not.toContain('secrets.CRON_SECRET || vars.CRON_SECRET');
  });

  it('requires dedicated ops auth and a healthy JSON body in strict readiness', () => {
    const script = read('scripts/open-readiness-check.mjs');

    expect(script).toContain("report?.status === 'healthy'");
    expect(script).toContain("report?.db_error == null");
    expect(script).toContain("addBlockedCheck('ops:dedicated-read-token'");
    expect(script).toContain("reason: 'blog_ops_read_token_missing'");
    expect(script).toContain("reason: 'dedicated_ops_auth_not_verified'");
    expect(script).toContain("reason: 'production_ops_token_not_configured'");
    expect(script).toContain("addBlockedCheck('ops:cron-fallback-enabled'");
    expect(script).toContain('tokenValueExposed: false');
  });
});
