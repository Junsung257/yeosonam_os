import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readRoute(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('launch ops and ingest route boundaries', () => {
  it('protects service-role ops dashboards with admin guard or CRON_SECRET', () => {
    for (const routePath of [
      'src/app/api/ops/cron-health/route.ts',
      'src/app/api/ops/blog-system/route.ts',
    ]) {
      const route = readRoute(routePath);

      expect(route).toContain("import { requireAdminRequest } from '@/lib/admin-guard'");
      expect(route).toContain('safeEqualString');
      expect(route).toContain("getSecret('CRON_SECRET')");
      expect(route).toContain('await requireAdminRequest(request)');
    }
  });

  it('allows the blog system probe to use a dedicated read-only token', () => {
    const route = readRoute('src/app/api/ops/blog-system/route.ts');

    expect(route).toContain("getSecret('BLOG_OPS_READ_TOKEN')");
    expect(route).toContain('BLOG_OPS_ALLOW_CRON_FALLBACK');
    expect(route).toContain('isOpsRead');
    expect(route).toContain('!isCron && !isOpsRead');
  });

  it('protects console links with admin guard before returning URLs', () => {
    const route = readRoute('src/app/api/ops/console-links/route.ts');

    expect(route).toContain("import { requireAdminRequest } from '@/lib/admin-guard'");
    expect(route).toContain('await requireAdminRequest(request)');
    expect(route.indexOf('await requireAdminRequest(request)')).toBeLessThan(
      route.indexOf('const supabase = supabaseDashboardUrl();'),
    );
  });

  it('checks Kakao paste ingest auth before parsing or service-role writes', () => {
    const route = readRoute('src/app/api/kakao/ingest/route.ts');

    expect(route).toContain("import { requireAdminRequest } from '@/lib/admin-guard'");
    expect(route.indexOf('await requireAdminRequest(request)')).toBeLessThan(
      route.indexOf('request.json()'),
    );
    expect(route.indexOf('await requireAdminRequest(request)')).toBeLessThan(
      route.indexOf('if (!isSupabaseConfigured)'),
    );
  });

  it('uses the shared admin guard for mileage analytics instead of route-local session checks', () => {
    const route = readRoute('src/app/api/admin/mileage-analytics/route.ts');

    expect(route).toContain("import { requireAdminRequest } from '@/lib/admin-guard'");
    expect(route).toContain('await requireAdminRequest(request)');
    expect(route).not.toContain('getSupabase');
    expect(route).not.toContain("from('admins')");
  });
});
