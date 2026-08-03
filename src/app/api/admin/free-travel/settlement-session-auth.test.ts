import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const routePaths = [
  'src/app/api/admin/free-travel/reconcile/route.ts',
  'src/app/api/admin/free-travel/unmatched/route.ts',
];

describe('free-travel settlement browser authentication', () => {
  it.each(routePaths)('uses the admin session guard without requiring an API token: %s', (routePath) => {
    const source = fs.readFileSync(path.join(process.cwd(), routePath), 'utf8');

    expect(source).toContain('withAdminGuard');
    expect(source).not.toContain('requireAdminApiToken');
  });
});
