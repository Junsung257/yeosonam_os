import { GET as getFinanceTax } from '@/app/api/admin/finance/tax/route';
import { type NextRequest } from 'next/server';

import { requireAdminRequest } from '@/lib/admin-guard';

// Compatibility route. Finance Center V3 owns the shared tax/evidence read model.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  return getFinanceTax(request);
}
