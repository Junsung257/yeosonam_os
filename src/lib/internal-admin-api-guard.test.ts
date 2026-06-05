import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const guardedInternalRoutes = [
  'src/app/api/margin/route.ts',
  'src/app/api/tax/route.ts',
  'src/app/api/tax/export/route.ts',
  'src/app/api/bookings/route.ts',
  'src/app/api/bookings/[id]/route.ts',
  'src/app/api/bookings/[id]/cancel/route.ts',
  'src/app/api/bookings/[id]/companions/invite/route.ts',
  'src/app/api/bookings/[id]/restore/route.ts',
  'src/app/api/bookings/[id]/timeline/route.ts',
  'src/app/api/bookings/[id]/transition/route.ts',
  'src/app/api/tenant/settlements/route.ts',
  'src/app/api/bookings/unsettled/route.ts',
  'src/app/api/bank-transactions/route.ts',
  'src/app/api/customers/route.ts',
  'src/app/api/customers/[id]/mileage-history/route.ts',
  'src/app/api/customers/[id]/notes/route.ts',
  'src/app/api/unmatched/route.ts',
  'src/app/api/unmatched/suggest/route.ts',
  'src/app/api/payments/auto-suggest/route.ts',
  'src/app/api/payments/export/route.ts',
  'src/app/api/payments/match-confirm/route.ts',
  'src/app/api/payments/match-intent/route.ts',
  'src/app/api/payments/operator-alias/route.ts',
  'src/app/api/payments/settlement-bundle/route.ts',
  'src/app/api/payments/settlement-confirm/route.ts',
  'src/app/api/payments/settlement-reverse/route.ts',
  'src/app/api/payments/settlements/route.ts',
];

describe('internal API admin guard', () => {
  it.each(guardedInternalRoutes)('%s requires an admin request before returning data', (relativePath) => {
    const source = readFileSync(join(process.cwd(), relativePath), 'utf8');

    expect(source).toContain("from '@/lib/admin-guard'");
    expect(source).toContain('requireAdminRequest');
    expect(source).toContain('const authError = await requireAdminRequest');
    expect(source).toContain('if (authError) return authError');
  });
});
